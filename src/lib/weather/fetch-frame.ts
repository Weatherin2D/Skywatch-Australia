import {
  GIBS_DISPLAY_WIDTH,
  GIBS_AU_ASPECT,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
  realEarthImageUrl,
  toIsoZ,
  type SatelliteProductId,
} from "@/lib/weather/maps";
import { getCachedFrame, setCachedFrame } from "@/lib/weather/frame-cache";

const MIN_FRAME_BYTES = 8_000;

function upstreamUrlFor(
  product: SatelliteProductId,
  timeUnix: number,
): string {
  const meta = getSatelliteProduct(product);
  if (meta.provider === "realearth") {
    if (!meta.realearthProduct) {
      throw new Error(`Product ${product} missing realearthProduct`);
    }
    return realEarthImageUrl(meta.realearthProduct, timeUnix, {
      width: GIBS_DISPLAY_WIDTH,
      height: Math.max(1, Math.round(GIBS_DISPLAY_WIDTH / GIBS_AU_ASPECT)),
    });
  }
  return gibsHimawariWmsUrl(toIsoZ(timeUnix * 1000), product, {
    width: GIBS_DISPLAY_WIDTH,
  });
}

/** Fetch a Himawari frame from GIBS/RealEarth (or memory cache) and store it. */
export async function fetchAndCacheFrame(
  product: SatelliteProductId,
  timeUnix: number,
): Promise<{ body: Buffer; contentType: string } | null> {
  const cached = getCachedFrame(product, timeUnix);
  if (cached) return { body: cached.body, contentType: cached.contentType };

  const upstream = upstreamUrlFor(product, timeUnix);

  try {
    const res = await fetch(upstream, {
      headers: { "User-Agent": "SkyWatchAustralia/1.0" },
      cache: "force-cache",
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.includes("image")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < MIN_FRAME_BYTES) return null;
    setCachedFrame(product, timeUnix, body, contentType);
    return { body, contentType };
  } catch {
    return null;
  }
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
      void fetchAndCacheFrame(product, time).finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  pump();
}
