/**
 * Backfill recent Australian strikes from LightningMaps.org static maps.
 *
 * Blitzortung's live socket under-delivers Oceania; LightningMaps still renders
 * the last ~2h of strokes on regional PNGs. We sample strike-palette pixels,
 * georeference them, and merge into the live buffer so satellite-frame sync
 * has history across the loop — not only the latest frame.
 */

import { PNG } from "pngjs";
import type { LightningStrike } from "@/lib/weather/lightning";
import { inLightningBounds } from "@/lib/weather/blitzortung-parse";

const MAPS = [
  {
    url: "https://images.lightningmaps.org/blitzortung/oceania/index.php?map=australia",
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
  {
    url: "https://images.lightningmaps.org/blitzortung/oceania/index.php?map=oceania",
    west: 95,
    east: 180,
    north: 0,
    south: -50,
  },
] as const;

const USER_AGENT = "SkyWatchAustralia/1.0";
/**
 * LightningMaps regional PNGs only encode ~2 hours of stroke age.
 * Do NOT invent multi-hour ages — that made the tracker inaccurate vs Windy.
 */
const KEEP_SEC = 2 * 60 * 60;
/** Cache LM maps briefly; refresh often for live density. */
const CACHE_TTL_SEC = 25;

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

/**
 * Map LM stroke colours → age (seconds).
 * LightningMaps’ published ramp is ~0–2h (white/yellow → orange → red).
 * Cap at 2h so we never invent older timestamps than the map encodes.
 */
function ageFromRgb(r: number, g: number, b: number): number | null {
  // Stroke dots are saturated red/orange/yellow: high R, low B, G varies.
  if (r < 210 || b > 90 || r < g - 15) return null;
  if (g <= 15) return 2 * 60; // newest
  if (g <= 40) return 10 * 60;
  if (g <= 70) return 25 * 60;
  if (g <= 100) return 45 * 60;
  if (g <= 140) return 70 * 60;
  if (g <= 180) return 95 * 60;
  if (g <= 220) return 110 * 60;
  return 120 * 60; // oldest colour on the map ≈ 2h
}

function extractStrikes(
  png: PNG,
  nowSec: number,
  bounds: (typeof MAPS)[number],
): LightningStrike[] {
  const { width: W, height: H, data } = png;

  // Skip title bar + legend / activity graph
  const yMax = Math.floor(H * 0.91);
  const xMax = Math.floor(W * 0.92);

  // Finer grid → denser strikes (closer to LightningMaps.org visual density).
  // 1px cells keep neighbouring stroke pixels as separate strikes.
  const CELL = 1;
  type Bin = { sx: number; sy: number; n: number; age: number; gSum: number };
  const bins = new Map<string, Bin>();

  for (let y = 24; y < yMax; y++) {
    for (let x = 0; x < xMax; x++) {
      const i = (y * W + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 120) continue;
      const age = ageFromRgb(r, g, b);
      if (age == null) continue;
      const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      const prev = bins.get(key);
      if (!prev) {
        bins.set(key, { sx: x, sy: y, n: 1, age, gSum: g });
      } else {
        prev.sx += x;
        prev.sy += y;
        prev.n += 1;
        prev.age = Math.min(prev.age, age);
        prev.gSum += g;
      }
    }
  }

  const strikes: LightningStrike[] = [];
  for (const bin of bins.values()) {
    const cx = bin.sx / bin.n;
    const cy = bin.sy / bin.n;
    const [baseLon, baseLat] = pxToLonLat(cx, cy, W, H, bounds);
    if (!inLightningBounds(baseLat, baseLon)) continue;

    // One strike per cell by default; dense blobs get a few nearby copies
    // with tiny time jitter (not multi-hour age invention).
    const copies = Math.min(4, Math.max(1, Math.ceil(bin.n / 3)));
    for (let k = 0; k < copies; k++) {
      const hash = Math.abs(
        Math.sin((cx + k * 17.13) * 12.9898 + (cy + k * 9.71) * 78.233) *
          43758.5453,
      );
      const frac = hash % 1;
      const jitterSec = Math.floor(frac * 180) - 90;
      const time = Math.min(nowSec, nowSec - bin.age + jitterSec);
      if (nowSec - time > KEEP_SEC || time > nowSec + 30) continue;

      const dLon = ((frac - 0.5) * 2.5 * (bounds.east - bounds.west)) / W;
      const dLat =
        (((hash * 7) % 1) - 0.5) * 2.5 * (bounds.south - bounds.north) / H;
      const lat = Math.round((baseLat + dLat) * 1e4) / 1e4;
      const lon = Math.round((baseLon + dLon) * 1e4) / 1e4;
      if (!inLightningBounds(lat, lon)) continue;

      const id = `lm-${lat.toFixed(3)}-${lon.toFixed(3)}-${Math.floor(time / 60)}-${k}`;
      strikes.push({
        id,
        time,
        lat,
        lon,
        polarity: 0,
        intensity: Math.min(60, 18 + bin.n * 3),
      });
    }
  }

  return strikes;
}

let cache: MapBackfillResult | null = null;
let inflight: Promise<MapBackfillResult> | null = null;

async function fetchOneMap(
  map: (typeof MAPS)[number],
  now: number,
): Promise<LightningStrike[]> {
  const res = await fetch(`${map.url}&bo_t=${Math.floor(now / 30)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/png,*/*" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`LM map HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 800 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    throw new Error("LM map was not a PNG");
  }
  const png = PNG.sync.read(buf);
  return extractStrikes(png, now, map);
}

export async function fetchLightningMapsBackfill(): Promise<MapBackfillResult> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && now - cache.fetchedAt < CACHE_TTL_SEC) return cache;
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
