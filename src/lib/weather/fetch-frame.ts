import { PNG } from "pngjs";
import {
  GIBS_DISPLAY_WIDTH,
  GIBS_REGION_DISPLAY_WIDTH,
  RE_MAX_WIDTH,
  boundsMercatorAspect,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
  realEarthImageUrl,
  realEarthRasterSize,
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

/** Descending RealEarth widths to try until the export is clean. */
function realEarthWidthLadder(bounds: LonLatBounds): number[] {
  const preferred = realEarthRasterSize(bounds).width;
  const ladder = [
    preferred,
    Math.min(preferred, 960),
    880,
    800,
    720,
    640,
    512,
  ];
  return [...new Set(ladder.map((w) => Math.max(320, Math.round(w))))].sort(
    (a, b) => b - a,
  );
}

function realEarthUrlAtSize(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  width: number,
): string | null {
  const meta = getSatelliteProduct(product);
  if (meta.provider !== "realearth" || !meta.realearthProduct) return null;
  const aspect = boundsMercatorAspect(bounds);
  const height = Math.max(1, Math.round(width / aspect));
  return realEarthImageUrl(meta.realearthProduct, timeUnix, {
    width: Math.min(width, RE_MAX_WIDTH),
    height,
    bounds,
  });
}

/**
 * RealEarth burns a semi-transparent SSEC badge into the bottom-left corner.
 * Rebuild that corner from imagery above and to the right so georefencing
 * stays intact and the mark disappears.
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

  const logoW = Math.max(72, Math.round(width * 0.13));
  const logoH = Math.max(72, Math.round(Math.min(height * 0.16, width * 0.15)));
  const y0 = height - logoH;
  const srcX0 = Math.min(
    width - 1,
    logoW + Math.max(10, Math.round(width * 0.03)),
  );

  for (let y = y0; y < height; y++) {
    const ty = (y - y0) / Math.max(1, logoH - 1); // 0 top of patch → 1 bottom
    for (let x = 0; x < logoW; x++) {
      const tx = x / Math.max(1, logoW - 1); // 0 left → 1 right of patch
      // Circular badge + baseline text under it.
      const radial = Math.hypot(tx * 1.05, (1 - ty) * 0.95);
      const baseline = ty > 0.55 && tx < 0.92 ? 1 : 0;
      const corner = (1 - tx) * (0.25 + 0.75 * ty);
      const w =
        radial < 0.98
          ? 1
          : baseline
            ? 0.95
            : corner > 0.2
              ? Math.min(1, corner / 0.28)
              : 0;
      if (w <= 0.02) continue;

      const srcY = Math.max(0, y0 - 8 - Math.floor((1 - ty) * 22));
      const srcX = Math.min(width - 1, srcX0 + Math.floor(x * 0.35));
      const di = (y * width + x) * 4;
      const siUp = (srcY * width + Math.min(width - 1, x)) * 4;
      const siRight = (y * width + srcX) * 4;
      for (let c = 0; c < 3; c++) {
        const src = Math.round(data[siUp + c]! * 0.65 + data[siRight + c]! * 0.35);
        data[di + c] = Math.round(data[di + c]! * (1 - w) + src * w);
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
 * Detect RealEarth's burned-in "Size limit exceeded" / attribution banner.
 * Oversized exports show bright glyph rows; clean Himawari crops do not.
 */
export function hasRealEarthSizeLimitOverlay(pngBuffer: Buffer): boolean {
  let png: PNG;
  try {
    png = PNG.sync.read(pngBuffer);
  } catch {
    return false;
  }
  const { width, height, data } = png;
  if (width < 64 || height < 64) return false;

  let maxRow = 0;
  let brightSum = 0;
  // Scan the lower 55% where the repeating banner is stamped.
  const y0 = Math.floor(height * 0.45);
  for (let y = y0; y < height; y++) {
    let bright = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const g = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      if (g > 175) bright += 1;
    }
    const ratio = bright / width;
    maxRow = Math.max(maxRow, ratio);
    brightSum += ratio;
  }

  // Clean AU/NSW IR frames stay under ~0.03 peak; watermarked ones jump to ~0.30.
  return maxRow >= 0.08 || brightSum >= 2.5;
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
  options?: { rejectSizeLimitOverlay?: boolean },
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
    if (options?.rejectSizeLimitOverlay && hasRealEarthSizeLimitOverlay(body)) {
      return null;
    }
    return { body, contentType };
  } catch {
    return null;
  }
}

/**
 * Fetch RealEarth at a size that avoids the "Size limit exceeded" overlay,
 * stepping down the ladder if needed, then strip the SSEC corner badge.
 */
async function fetchRealEarthClean(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
): Promise<{ body: Buffer; contentType: string } | null> {
  for (const width of realEarthWidthLadder(bounds)) {
    const url = realEarthUrlAtSize(product, timeUnix, bounds, width);
    if (!url) return null;
    for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
      const got = await fetchUpstreamOnce(url, {
        rejectSizeLimitOverlay: true,
      });
      if (!got) {
        if (attempt < FETCH_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
        continue;
      }
      return {
        body: stripRealEarthWatermark(got.body),
        contentType: got.contentType,
      };
    }
  }
  return null;
}

/**
 * RealEarth-primary products (IR/visible/airmass/etc.): fetch RealEarth first
 * so national AND state crops stay on the fresher timeline — at a size that
 * keeps the export free of SSEC's size-limit banner. Fall back to GIBS only
 * when RealEarth misses. Pure GIBS products keep GIBS-only.
 */
async function fetchUpstreamWithRetry(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const meta = getSatelliteProduct(product);
  const gibsUrl = gibsUrlFor(product, timeUnix, bounds, region);

  if (meta.provider === "realearth") {
    const re = await fetchRealEarthClean(product, timeUnix, bounds);
    if (re) return re;
  }

  const tryUrls: Array<{ url: string; strip: boolean }> = [];
  if (meta.provider !== "realearth") {
    // Non-RE products: GIBS first; optional RE secondary.
    if (gibsUrl) tryUrls.push({ url: gibsUrl, strip: false });
    const reUrl = realEarthUrlAtSize(
      product,
      timeUnix,
      bounds,
      realEarthRasterSize(bounds).width,
    );
    if (reUrl) tryUrls.push({ url: reUrl, strip: true });
  } else if (gibsUrl) {
    tryUrls.push({ url: gibsUrl, strip: false });
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
      const got = await fetchUpstreamOnce(url, {
        rejectSizeLimitOverlay: strip,
      });
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
