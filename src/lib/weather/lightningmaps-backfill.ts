/**
 * Backfill recent Australian strikes from LightningMaps.org static maps.
 *
 * Blitzortung's live socket under-delivers Oceania; LightningMaps still renders
 * the last 2h of strokes on its Australia PNGs. We sample strike palette
 * pixels, georeference them, and merge into the live buffer.
 */

import { PNG } from "pngjs";
import type { LightningStrike } from "@/lib/weather/lightning";
import { inLightningBounds } from "@/lib/weather/blitzortung-parse";

const MAPS = [
  {
    url: "https://images.lightningmaps.org/blitzortung/oceania/index.php?map=australia",
    /** Equirectangular bounds calibrated to the published Australia basemap. */
    west: 110,
    east: 155,
    north: -10,
    south: -45,
  },
  {
    url: "https://images.lightningmaps.org/blitzortung/oceania/index.php?map=australia_big",
    west: 105,
    east: 160,
    north: -8,
    south: -48,
  },
] as const;

/** Exact 8-bit palette entries used for stroke dots on LM maps. */
const STROKE_RGB: Array<{ r: number; g: number; b: number; ageSec: number }> = [
  { r: 255, g: 0, b: 0, ageSec: 3 * 60 },
  { r: 255, g: 25, b: 0, ageSec: 8 * 60 },
  { r: 255, g: 50, b: 0, ageSec: 15 * 60 },
  { r: 255, g: 100, b: 0, ageSec: 30 * 60 },
  { r: 255, g: 150, b: 0, ageSec: 45 * 60 },
  { r: 255, g: 200, b: 0, ageSec: 70 * 60 },
  { r: 255, g: 255, b: 0, ageSec: 100 * 60 },
];

const USER_AGENT = "SkyWatchAustralia/1.0";
/** Keep up to 2h from the static maps; UI filters to 60 min. */
const KEEP_SEC = 120 * 60;

export type MapBackfillResult = {
  strikes: LightningStrike[];
  fetchedAt: number;
};

function pxToLonLat(
  x: number,
  y: number,
  w: number,
  h: number,
  bounds: (typeof MAPS)[number],
): [number, number] {
  const lon = bounds.west + ((bounds.east - bounds.west) * x) / w;
  const lat = bounds.north + ((bounds.south - bounds.north) * y) / h;
  return [lon, lat];
}

function ageFromRgb(r: number, g: number, b: number): number | null {
  for (const p of STROKE_RGB) {
    if (r === p.r && g === p.g && b === p.b) return p.ageSec;
  }
  // Soft match for anti-aliased edges of palette dots
  if (r >= 250 && b <= 20 && g <= 210) {
    if (g <= 20) return 3 * 60;
    if (g <= 60) return 12 * 60;
    if (g <= 120) return 30 * 60;
    if (g <= 180) return 55 * 60;
    return 90 * 60;
  }
  return null;
}

function extractStrikes(
  png: PNG,
  nowSec: number,
  bounds: (typeof MAPS)[number],
): LightningStrike[] {
  const { width: W, height: H, data } = png;
  const hits: Array<{
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    age: number;
  }> = [];

  // Skip title bar + legend (bottom-right activity graph)
  const yMax = Math.floor(H * 0.92);
  const xMax = Math.floor(W * 0.9);

  for (let y = 28; y < yMax; y++) {
    for (let x = 0; x < xMax; x++) {
      const i = (y * W + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 180) continue;
      const age = ageFromRgb(r, g, b);
      if (age == null) continue;
      hits.push({ x, y, r, g, b, age });
    }
  }

  const used = new Uint8Array(hits.length);
  const strikes: LightningStrike[] = [];

  for (let i = 0; i < hits.length; i++) {
    if (used[i]) continue;
    const q = [i];
    used[i] = 1;
    const pts = [hits[i]!];
    while (q.length) {
      const k = q.pop()!;
      const a = hits[k]!;
      for (let j = 0; j < hits.length; j++) {
        if (used[j]) continue;
        const b = hits[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) <= 4) {
          used[j] = 1;
          q.push(j);
          pts.push(b);
        }
      }
    }
    // Palette dots are often 1–3 px; reject only huge label blobs
    if (pts.length > 50) continue;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const [lon, lat] = pxToLonLat(cx, cy, W, H, bounds);
    if (!inLightningBounds(lat, lon)) continue;
    const age = Math.min(...pts.map((p) => p.age));
    const time = nowSec - age;
    if (nowSec - time > KEEP_SEC) continue;
    const id = `lm-${lat.toFixed(3)}-${lon.toFixed(3)}-${Math.floor(time / 180)}`;
    strikes.push({
      id,
      time,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      polarity: 0,
      intensity: 28,
    });
  }

  return strikes;
}

let cache: MapBackfillResult | null = null;
let inflight: Promise<MapBackfillResult> | null = null;

async function fetchOneMap(
  map: (typeof MAPS)[number],
  now: number,
): Promise<LightningStrike[]> {
  const res = await fetch(`${map.url}&bo_t=${Math.floor(now / 60)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/png,*/*" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`LM map HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] !== 0x89 || buf[1] !== 0x50) {
    throw new Error("LM map was not a PNG");
  }
  const png = PNG.sync.read(buf);
  return extractStrikes(png, now, map);
}

export async function fetchLightningMapsBackfill(): Promise<MapBackfillResult> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && now - cache.fetchedAt < 45) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const batches = await Promise.all(
        MAPS.map(async (map) => {
          try {
            return await fetchOneMap(map, now);
          } catch (err) {
            console.error("LightningMaps backfill map failed", map.url, err);
            return [] as LightningStrike[];
          }
        }),
      );
      const byId = new Map<string, LightningStrike>();
      for (const batch of batches) {
        for (const s of batch) {
          const prev = byId.get(s.id);
          if (!prev || s.time > prev.time) byId.set(s.id, s);
        }
      }
      const strikes = [...byId.values()].filter(
        (s) => now - s.time <= KEEP_SEC,
      );
      cache = { strikes, fetchedAt: now };
      return cache;
    } catch (err) {
      console.error("LightningMaps backfill failed", err);
      return cache ?? { strikes: [], fetchedAt: now };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
