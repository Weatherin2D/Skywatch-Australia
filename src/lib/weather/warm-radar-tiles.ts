/**
 * Server-side radar tile warm — fetch + recolour into the process cache so the
 * first client paint is a cache hit.
 */

import {
  RADAR_NATIVE_MAX_ZOOM,
  rainviewerRawTileUrl,
  recolourRadarPng,
  type RadarWarmupBounds,
} from "@/lib/weather/radar-palette";
import {
  getCachedRadarTile,
  radarTileCacheKey,
  setCachedRadarTile,
} from "@/lib/weather/radar-tile-cache";

const AU_BOUNDS: RadarWarmupBounds = {
  south: -45,
  west: 110,
  north: -8,
  east: 155,
};

const DEG2RAD = Math.PI / 180;

function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return ((lon + 180) / 360) * n;
}

function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = clamped * DEG2RAD;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
}

function tileRange(
  z: number,
  bounds: RadarWarmupBounds,
  maxTiles: number,
): { x: number; y: number }[] {
  if (z < 0 || z > RADAR_NATIVE_MAX_ZOOM) return [];
  const n = 2 ** z;
  let x0 = Math.floor(lonToTileX(bounds.west, z)) - 1;
  let x1 = Math.ceil(lonToTileX(bounds.east, z)) + 1;
  let y0 = Math.floor(latToTileY(bounds.north, z)) - 1;
  let y1 = Math.ceil(latToTileY(bounds.south, z)) + 1;
  x0 = Math.max(0, x0);
  x1 = Math.min(n - 1, x1);
  y0 = Math.max(0, y0);
  y1 = Math.min(n - 1, y1);

  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  if (width * height > maxTiles) {
    const maxSide = Math.max(1, Math.floor(Math.sqrt(maxTiles)));
    const cx = Math.floor((x0 + x1) / 2);
    const cy = Math.floor((y0 + y1) / 2);
    const half = Math.floor(maxSide / 2);
    x0 = Math.max(0, cx - half);
    x1 = Math.min(n - 1, x0 + maxSide - 1);
    y0 = Math.max(0, cy - half);
    y1 = Math.min(n - 1, y0 + maxSide - 1);
  }

  const out: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      out.push({ x, y });
    }
  }
  return out;
}

async function warmOne(
  host: string,
  path: string,
  z: number,
  x: number,
  y: number,
): Promise<void> {
  const key = radarTileCacheKey(host, path, z, x, y);
  if (getCachedRadarTile(key)) return;
  const upstream = rainviewerRawTileUrl(host, path, z, x, y);
  const res = await fetch(upstream, {
    headers: { Accept: "image/png" },
    cache: "force-cache",
    next: { revalidate: 7200 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return;
  const buf = Buffer.from(await res.arrayBuffer());
  setCachedRadarTile(key, recolourRadarPng(buf));
}

/**
 * Warm AU tiles for the given RainViewer frames (host + path pairs).
 * Fire-and-forget — never throws to the caller.
 */
export function warmRadarFramesInBackground(
  frames: { host: string; path: string }[],
  zooms: number[] = [4, 5, 6, 7],
): void {
  if (!frames.length) return;
  void Promise.resolve().then(async () => {
    const jobs: { host: string; path: string; z: number; x: number; y: number }[] =
      [];
    for (const f of frames) {
      for (const z of zooms) {
        // z7 is denser — keep the national warm window modest.
        const cap = z >= 7 ? 36 : z >= 6 ? 48 : 56;
        for (const { x, y } of tileRange(z, AU_BOUNDS, cap)) {
          jobs.push({ host: f.host, path: f.path, z, x, y });
        }
      }
    }
    const CONCURRENCY = 16;
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const slice = jobs.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map((j) =>
          warmOne(j.host, j.path, j.z, j.x, j.y).catch(() => undefined),
        ),
      );
    }
  });
}
