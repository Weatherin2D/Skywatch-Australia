/** Capture + store Australian RainViewer radar tiles for the archive. */

import {
  putRadarFrame,
  radarFrameExists,
} from "@/lib/weather/archive-storage";
import { quantizeArchiveStamp } from "@/lib/weather/archive-time";
import { rainviewerRawTileUrl } from "@/lib/weather/radar-palette";
import { ensureArchiveMeta } from "@/lib/weather/archive-storage";

const RAINVIEWER_URL = "https://api.rainviewer.com/public/weather-maps.json";
const ARCHIVE_RADAR_ZOOMS = [4, 5, 6];
const ARCHIVE_RADAR_TILES_PER_ZOOM = { 4: 40, 5: 48, 6: 36 };
const ARCHIVE_RADAR_BUDGET_MS = 28_000;

/**
 * Find the RainViewer past-frame closest to `targetUnix` and capture its
 * tiles into archive storage. Returns true if at least one tile was stored.
 * Respects the archive epoch: only captures frames within [epoch, now].
 */
export async function ensureArchiveRadarAt(targetUnix: number): Promise<boolean> {
  const stamp = quantizeArchiveStamp(targetUnix);
  const now = Math.floor(Date.now() / 1000);

  try {
    const meta = await ensureArchiveMeta();
    if (stamp < meta.epochUnix || stamp > now) return false;
  } catch {
    return false;
  }

  let host = "https://tilecache.rainviewer.com";
  let past: Array<{ time: number; path: string }> = [];

  try {
    const res = await fetch(RAINVIEWER_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      host?: string;
      radar?: { past?: Array<{ time: number; path: string }> };
    };
    host = data.host ?? host;
    past = data.radar?.past ?? [];
  } catch {
    return false;
  }

  if (!past.length) return false;

  // Pick the frame whose time is closest to the target stamp.
  let best: { time: number; path: string } | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const f of past) {
    const delta = Math.abs(f.time - stamp);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = f;
    }
  }
  if (!best || bestDelta > 30 * 60) return false; // must be within 30 min

  const started = Date.now();
  let stored = 0;
  for (const z of ARCHIVE_RADAR_ZOOMS) {
    if (Date.now() - started > ARCHIVE_RADAR_BUDGET_MS) break;
    const cap = (ARCHIVE_RADAR_TILES_PER_ZOOM as Record<number, number>)[z] ?? 32;
    const tiles = radarTileCoords(z, cap);
    for (const { x, y } of tiles) {
      if (Date.now() - started > ARCHIVE_RADAR_BUDGET_MS) break;
      const key = `${best.path}:${z}:${x}:${y}`;
      if (await radarFrameExists(best.path, z, x, y)) continue;
      try {
        const url = rainviewerRawTileUrl(host, best.path, z, x, y, 256, false);
        const res = await fetch(url, {
          headers: { Accept: "image/png" },
          cache: "force-cache",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        await putRadarFrame(best.path, z, x, y, buf);
        stored += 1;
      } catch {
        /* skip individual tile failures */
      }
    }
  }
  return stored > 0;
}

/** Generate tile coords within an Australia window, capped per zoom. */
function radarTileCoords(
  z: number,
  maxTiles: number,
): { x: number; y: number }[] {
  const bounds = { south: -45, west: 110, north: -8, east: 155 };
  const n = 2 ** z;
  const DEG2RAD = Math.PI / 180;
  const lonToTileX = (lon: number) => ((lon + 180) / 360) * n;
  const latToTileY = (lat: number) => {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = clamped * DEG2RAD;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  };

  let x0 = Math.floor(lonToTileX(bounds.west)) - 1;
  let x1 = Math.ceil(lonToTileX(bounds.east)) + 1;
  let y0 = Math.floor(latToTileY(bounds.north)) - 1;
  let y1 = Math.ceil(latToTileY(bounds.south)) + 1;
  x0 = Math.max(0, x0);
  x1 = Math.min(n - 1, x1);
  y0 = Math.max(0, y0);
  y1 = Math.min(n - 1, y1);

  const out: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      out.push({ x, y });
      if (out.length >= maxTiles) return out;
    }
  }
  return out;
}