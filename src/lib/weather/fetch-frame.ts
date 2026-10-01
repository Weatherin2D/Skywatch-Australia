import { PNG } from "pngjs";
import {
  GIBS_DISPLAY_WIDTH,
  GIBS_REGION_DISPLAY_WIDTH,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
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

/**
 * NASA GIBS burns a small meatball logo into the bottom-left corner.
 * Rebuild that corner from neighbouring imagery so georefencing stays intact.
 */
export function stripCornerBadge(pngBuffer: Buffer): Buffer {
  let png: PNG;
  try {
    png = PNG.sync.read(pngBuffer);
  } catch {
    return pngBuffer;
  }
  const { width, height, data } = png;
  if (width < 64 || height < 64) return pngBuffer;

  const logoW = Math.max(72, Math.round(width * 0.14));
  const logoH = Math.max(80, Math.round(Math.min(height * 0.18, width * 0.16)));
  const y0 = height - logoH;
  const srcX0 = Math.min(
    width - 1,
    logoW + Math.max(10, Math.round(width * 0.03)),
  );

  for (let y = y0; y < height; y++) {
    const ty = (y - y0) / Math.max(1, logoH - 1);
    for (let x = 0; x < logoW; x++) {
      const tx = x / Math.max(1, logoW - 1);
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

/** @deprecated Use stripCornerBadge — kept for any older imports. */
export const stripRealEarthWatermark = stripCornerBadge;

/**
 * Reject GIBS "empty" placeholders that still return HTTP 200 for unpublished
 * times (tiny nearly-black PNGs). Real Himawari crops are much richer.
 */
function frameHasRealContent(body: Buffer): boolean {
  if (body.length < MIN_FRAME_BYTES) return false;

  if (body.length >= 80_000) {
    let bright = 0;
    for (let i = 64; i < Math.min(body.length, 6000); i += 13) {
      if (body[i]! > 18) bright += 1;
    }
    return bright >= 8;
  }

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
    return litRatio >= 0.04 && variance >= 180;
  } catch {
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
 * Fetch NASA GIBS Himawari for national and state crops. Strip the NASA
 * corner badge. No RealEarth — keeps every region on one watermark-free source.
 */
async function fetchUpstreamWithRetry(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const meta = getSatelliteProduct(product);
  let gibsUrl = gibsUrlFor(product, timeUnix, bounds, region);

  if (!gibsUrl && meta.provider === "gibs") {
    gibsUrl = gibsHimawariWmsUrl(toIsoZ(timeUnix * 1000), product, {
      width:
        region !== "national" ? GIBS_REGION_DISPLAY_WIDTH : GIBS_DISPLAY_WIDTH,
      bounds,
    });
  }
  if (!gibsUrl) return null;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const got = await fetchUpstreamOnce(gibsUrl);
    if (got) {
      return {
        body: stripCornerBadge(got.body),
        contentType: got.contentType,
      };
    }
    if (attempt < FETCH_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  return null;
}

/** Fetch a Himawari frame from GIBS (or memory cache) and store it. */
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
 * Exact time first, then neighbouring 10-minute slots (GIBS publish lag).
 * Walk further back so unpublished tip stubs don't blank the loop.
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
    -2 * HIMAWARI_STEP_SEC,
    -3 * HIMAWARI_STEP_SEC,
    -4 * HIMAWARI_STEP_SEC,
    -5 * HIMAWARI_STEP_SEC,
    -6 * HIMAWARI_STEP_SEC,
    -7 * HIMAWARI_STEP_SEC,
    -8 * HIMAWARI_STEP_SEC,
    HIMAWARI_STEP_SEC,
  ];
  for (const off of offsets) {
    const t = timeUnix + off;
    if (t <= 0) continue;
    const got =
      off === 0
        ? await fetchUpstreamWithRetry(product, t, frameBounds, region)
        : await fetchAndCacheFrame(product, t, frameBounds, region);
    if (!got) continue;
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
