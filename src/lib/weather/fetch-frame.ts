import { PNG } from "pngjs";
import {
  GIBS_DISPLAY_WIDTH,
  GIBS_REGION_DISPLAY_WIDTH,
  boundsMercatorAspect,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
  realEarthImageUrl,
  toIsoZ,
  type LonLatBounds,
  type SatelliteProductId,
} from "@/lib/weather/maps";
import { getCachedFrame, setCachedFrame } from "@/lib/weather/frame-cache";

const MIN_FRAME_BYTES = 12_000;
const HIMAWARI_STEP_SEC = 10 * 60;
const FETCH_ATTEMPTS = 3;

function gibsUrlFor(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): string | null {
  const meta = getSatelliteProduct(product);
  if (!meta.gibsLayer) return null;
  const isRegional = region !== "national";
  const width = isRegional ? GIBS_REGION_DISPLAY_WIDTH : GIBS_DISPLAY_WIDTH;
  return gibsHimawariWmsUrl(toIsoZ(timeUnix * 1000), product, {
    width,
    bounds,
  });
}

function realEarthUrlFor(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): string | null {
  const meta = getSatelliteProduct(product);
  if (meta.provider !== "realearth" || !meta.realearthProduct) return null;
  const isRegional = region !== "national";
  const width = isRegional ? GIBS_REGION_DISPLAY_WIDTH : GIBS_DISPLAY_WIDTH;
  const aspect = boundsMercatorAspect(bounds);
  const height = Math.max(1, Math.round(width / aspect));
  return realEarthImageUrl(meta.realearthProduct, timeUnix, {
    width,
    height,
    bounds,
  });
}

/**
 * RealEarth /api/image burns a semi-transparent SSEC logo into the
 * bottom-left corner. Replace that corner from neighbouring imagery so
 * georefencing stays intact and the mark disappears.
 */
export function stripRealEarthWatermark(pngBuffer: Buffer): Buffer {
  let png: PNG;
  try {
    png = PNG.sync.read(pngBuffer);
  } catch {
    return pngBuffer;
  }
  const { width, height, data } = png;
  if (width < 64 || height < 64) return pngBuffer;

  // Logo is a small circular SSEC mark in the extreme bottom-left.
  const logoW = Math.max(56, Math.round(width * 0.11));
  const logoH = Math.max(56, Math.round(height * 0.13));
  const x0 = 0;
  const y0 = height - logoH;
  const srcX0 = Math.min(
    width - logoW,
    logoW + Math.max(6, Math.round(width * 0.02)),
  );

  for (let y = y0; y < height; y++) {
    const ty = (y - y0) / Math.max(1, logoH - 1); // 0 top of patch → 1 bottom
    for (let x = x0; x < logoW; x++) {
      const tx = x / Math.max(1, logoW - 1); // 0 left → 1 right of patch
      // Full replace in the outer corner; feather only toward clean imagery.
      const corner = (1 - tx) * (0.35 + 0.65 * ty);
      const w = corner > 0.22 ? 1 : corner / 0.22;
      if (w <= 0.01) continue;
      const di = (y * width + x) * 4;
      const si = (y * width + (srcX0 + x)) * 4;
      for (let c = 0; c < 3; c++) {
        const dst = data[di + c]!;
        const src = data[si + c]!;
        data[di + c] = Math.round(dst * (1 - w) + src * w);
      }
    }
  }

  try {
    return PNG.sync.write(png);
  } catch {
    return pngBuffer;
  }
}

/**
 * Reject GIBS "empty" placeholders that still return HTTP 200 for unpublished
 * times (tiny nearly-black PNGs). Real Himawari crops are much richer.
 */
function frameHasRealContent(body: Buffer): boolean {
  if (body.length < MIN_FRAME_BYTES) return false;

  // Fast path: substantial payloads are almost always real imagery.
  if (body.length >= 80_000) {
    let bright = 0;
    for (let i = 64; i < Math.min(body.length, 6000); i += 13) {
      if (body[i]! > 18) bright += 1;
    }
    return bright >= 8;
  }

  // Decode smaller candidates and require meaningful luminance spread.
  try {
    const png = PNG.sync.read(body);
    const { width, height, data } = png;
    if (width < 32 || height < 32) return false;
    let sum = 0;
    let sum2 = 0;
    let lit = 0;
    let n = 0;
    const step = Math.max(1, Math.floor((width * height) / 2500));
    for (let i = 0; i < width * height; i += step) {
      const o = i * 4;
      const g = (data[o]! + data[o + 1]! + data[o + 2]!) / 3;
      sum += g;
      sum2 += g * g;
      if (g > 22) lit += 1;
      n += 1;
    }
    if (n < 50) return false;
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    const litRatio = lit / n;
    // Empty GIBS stubs are dark + low variance; real IR has cloud structure.
    return litRatio >= 0.04 && variance >= 180;
  } catch {
    // If we can't decode, fall back to a stricter compressed-size gate.
    return body.length >= 40_000;
  }
}

async function fetchUpstreamOnce(
  upstream: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(upstream, {
      headers: {
        "User-Agent": "SkyWatchAustralia/1.0",
        Accept: "image/png,image/*;q=0.9,*/*;q=0.1",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.includes("image")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (!frameHasRealContent(body)) return null;
    return { body, contentType };
  } catch {
    return null;
  }
}

/**
 * RealEarth-primary products (IR/visible/airmass/etc.): fetch RealEarth first
 * so national AND state crops stay on the fresher timeline. Fall back to GIBS
 * only when RealEarth misses. Pure GIBS products keep GIBS-only.
 */
async function fetchUpstreamWithRetry(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const meta = getSatelliteProduct(product);
  const gibsUrl = gibsUrlFor(product, timeUnix, bounds, region);
  const reUrl = realEarthUrlFor(product, timeUnix, bounds, region);

  const tryUrls: Array<{ url: string; strip: boolean }> = [];
  if (meta.provider === "realearth") {
    if (reUrl) tryUrls.push({ url: reUrl, strip: true });
    if (gibsUrl) tryUrls.push({ url: gibsUrl, strip: false });
  } else {
    if (gibsUrl) tryUrls.push({ url: gibsUrl, strip: false });
    if (reUrl) tryUrls.push({ url: reUrl, strip: true });
  }

  if (tryUrls.length === 0 && meta.provider === "gibs") {
    const fallback = gibsHimawariWmsUrl(toIsoZ(timeUnix * 1000), product, {
      width:
        region !== "national" ? GIBS_REGION_DISPLAY_WIDTH : GIBS_DISPLAY_WIDTH,
      bounds,
    });
    tryUrls.push({ url: fallback, strip: false });
  }

  for (const { url, strip } of tryUrls) {
    for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
      const got = await fetchUpstreamOnce(url);
      if (!got) {
        if (attempt < FETCH_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
        continue;
      }
      if (!strip) return got;
      return {
        body: stripRealEarthWatermark(got.body),
        contentType: got.contentType,
      };
    }
  }
  return null;
}

/** Fetch a Himawari frame from GIBS/RealEarth (or memory cache) and store it. */
export async function fetchAndCacheFrame(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds = [
    [-48, 105],
    [-5, 165],
  ],
  region = "national",
): Promise<{ body: Buffer; contentType: string } | null> {
  const cached = getCachedFrame(product, timeUnix, region);
  if (cached) return { body: cached.body, contentType: cached.contentType };

  const got = await fetchUpstreamWithRetry(product, timeUnix, bounds, region);
  if (!got) return null;
  setCachedFrame(product, timeUnix, got.body, got.contentType, region);
  return got;
}

/**
 * Exact time first, then neighbouring 10-minute slots (publish lag /
 * daytime-only gaps). Caches under the requested key so playback stays smooth.
 */
export async function fetchAndCacheFrameResilient(
  product: SatelliteProductId,
  timeUnix: number,
  bounds?: LonLatBounds,
  region = "national",
): Promise<{ body: Buffer; contentType: string; resolvedTime: number } | null> {
  const frameBounds: LonLatBounds = bounds ?? [
    [-48, 105],
    [-5, 165],
  ];
  const cached = getCachedFrame(product, timeUnix, region);
  if (cached) {
    return {
      body: cached.body,
      contentType: cached.contentType,
      resolvedTime: timeUnix,
    };
  }

  const offsets = [
    0,
    -HIMAWARI_STEP_SEC,
    HIMAWARI_STEP_SEC,
    -2 * HIMAWARI_STEP_SEC,
  ];
  for (const off of offsets) {
    const t = timeUnix + off;
    if (t <= 0) continue;
    const got =
      off === 0
        ? await fetchUpstreamWithRetry(product, t, frameBounds, region)
        : await fetchAndCacheFrame(product, t, frameBounds, region);
    if (!got) continue;
    // Store under the requested key so the loop URL keeps working.
    setCachedFrame(product, timeUnix, got.body, got.contentType, region);
    if (off !== 0) {
      setCachedFrame(product, t, got.body, got.contentType, region);
    }
    return { ...got, resolvedTime: t };
  }
  return null;
}

/** Warm the in-memory cache for a product without blocking the caller. */
export function warmFramesInBackground(
  product: SatelliteProductId,
  times: number[],
  concurrency = 2,
): void {
  let cursor = 0;
  let active = 0;

  const pump = () => {
    while (active < concurrency && cursor < times.length) {
      const time = times[cursor]!;
      cursor += 1;
      active += 1;
      void fetchAndCacheFrameResilient(product, time).finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  pump();
}
