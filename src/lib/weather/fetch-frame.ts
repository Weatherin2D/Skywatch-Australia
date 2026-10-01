import {
  FRAME_QUALITY_TAG,
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

const MIN_FRAME_BYTES = 8_000;
const HIMAWARI_STEP_SEC = 10 * 60;
const FETCH_ATTEMPTS = 3;

function upstreamUrlFor(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): string {
  const meta = getSatelliteProduct(product);
  const isRegional = region !== "national";
  const width = isRegional ? GIBS_REGION_DISPLAY_WIDTH : GIBS_DISPLAY_WIDTH;
  const aspect = boundsMercatorAspect(bounds);
  const height = Math.max(1, Math.round(width / aspect));
  if (meta.provider === "realearth") {
    if (!meta.realearthProduct) {
      throw new Error(`Product ${product} missing realearthProduct`);
    }
    return realEarthImageUrl(meta.realearthProduct, timeUnix, {
      width,
      height,
      bounds,
    });
  }
  return gibsHimawariWmsUrl(toIsoZ(timeUnix * 1000), product, {
    width,
    bounds,
  });
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
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.includes("image")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < MIN_FRAME_BYTES) return null;
    // Reject near-empty / error tiles (almost all black PNG).
    let bright = 0;
    for (let i = 64; i < Math.min(body.length, 4000); i += 17) {
      if (body[i]! > 20) bright += 1;
    }
    if (bright < 4) return null;
    return { body, contentType };
  } catch {
    return null;
  }
}

async function fetchUpstreamWithRetry(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const upstream = upstreamUrlFor(product, timeUnix, bounds, region);
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const got = await fetchUpstreamOnce(upstream);
    if (got) return got;
    if (attempt < FETCH_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
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

  const offsets = [0, -HIMAWARI_STEP_SEC, HIMAWARI_STEP_SEC, -2 * HIMAWARI_STEP_SEC];
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
