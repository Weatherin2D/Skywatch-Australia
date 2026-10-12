/**
 * Backfill Australian strikes from LightningMaps.org static maps.
 *
 * Blitzortung’s live socket under-delivers Oceania on serverless. LightningMaps
 * encodes real stroke ages on regional Mercator PNGs (MyBlitzortung). We sample
 * strike-palette pixels with the official map coords + Mercator inverse so
 * placement matches the published maps, then merge into the live buffer.
 *
 * Fetch both a fine 1–2h map (recent timing for the fresher RealEarth tip)
 * and a 12h map (covers the full Himawari IR loop, typically ~20–40 min behind
 * wall clock and spanning ~4h).
 */

import { PNG } from "pngjs";
import type { LightningStrike } from "@/lib/weather/lightning";
import { sampleStrikesAcrossTime } from "@/lib/weather/lightning";
import { inLightningBounds } from "@/lib/weather/blitzortung-parse";

/** Cap LM inject so one busy east-coast map cannot fill the live buffer alone. */
const MAX_BACKFILL_STRIKES = 12_000;

/**
 * Official MyBlitzortung templates (includes/templates.inc.php).
 * Projection defaults to Mercator; coord = North, East, South, West.
 *
 * australia_big alone under-samples WA when the east coast is lit — keep
 * oceania as a second source. Do not ingest the Indonesia map (out of domain).
 */
const MAPS = [
  {
    id: "australia_big",
    url: "https://images.lightningmaps.org/blitzortung/oceania/index.php?map=australia_big",
    north: -8,
    east: 159,
    south: -45,
    west: 109,
    /** Prefer this map when deduping overlapping strokes. */
    priority: 3,
  },
  {
    id: "oceania",
    url: "https://images.lightningmaps.org/blitzortung/oceania/index.php?map=oceania",
    north: 10,
    east: 180,
    south: -51.6,
    west: 110,
    priority: 2,
  },
] as const;

/** Recent timing + loop-length history (skip redundant 1h when 2h covers it). */
const PERIODS_H = [2, 12] as const;

const USER_AGENT = "Thunderstate/1.0";
/** Keep up to the longest fetched period. */
const KEEP_SEC = Math.max(...PERIODS_H) * 60 * 60;
/** MyBlitzortung col_smooth default — age steps across the colour ramp. */
const COLOR_STEPS = 24;
const CACHE_TTL_SEC = 120;

export type MapBackfillResult = {
  strikes: LightningStrike[];
  fetchedAt: number;
};

type MapCfg = (typeof MAPS)[number];

/** MyBlitzortung mercator (lon/360, log-tan / π / 2). */
function mercator(lat: number, lon: number): [number, number] {
  const x = lon / 360;
  const y =
    Math.log(Math.tan(Math.PI / 4 + ((lat * Math.PI) / 180) / 2)) /
    Math.PI /
    2;
  return [x, y];
}

function invMercY(m: number): number {
  return (
    ((2 * Math.atan(Math.exp(m * 2 * Math.PI)) - Math.PI / 2) * 180) / Math.PI
  );
}

/**
 * Inverse of BoMapProjection::LatLon2Image for default Mercator maps
 * (full-image calibration, no pixel inset).
 */
function pxToLonLat(
  ix: number,
  iy: number,
  w: number,
  h: number,
  map: MapCfg,
): [number, number] {
  const [xSW, ySW] = mercator(map.south, map.west);
  const [xNE, yNE] = mercator(map.north, map.east);
  const calX = w / (xNE - xSW);
  const calY = h / (yNE - ySW);
  const offX = xSW * calX;
  const offY = ySW * calY + h;
  const lon = (360 * (ix + offX)) / calX;
  const mercY = (offY - iy) / calY;
  const lat = invMercY(mercY);
  return [lon, lat];
}

/**
 * Stroke colours → age within `periodSec`.
 * Ramp is white/yellow (high G, newest) → red (low G, oldest at period end).
 * Matches MyBlitzortung’s smoothed standard palette (~24 steps).
 */
function ageFromRgb(
  r: number,
  g: number,
  b: number,
  periodSec: number,
): number | null {
  // Saturated strike dots: high R, low B, G encodes age along the ramp.
  // Slightly looser R floor catches dimmer western/oceania palette steps.
  if (r < 185 || b > 110 || r < g - 25) return null;
  // Ignore near-white land labels / chrome bleed.
  if (g > 245 && b > 180) return null;
  const t = 1 - Math.min(1, Math.max(0, g / 220));
  return Math.round(t * periodSec);
}

function hash01(x: number, y: number, k: number): number {
  return (
    Math.abs(Math.sin((x + k * 17.13) * 12.9898 + (y + k * 9.71) * 78.233) *
      43758.5453) % 1
  );
}

function extractStrikes(
  png: PNG,
  nowSec: number,
  map: MapCfg,
  periodSec: number,
): LightningStrike[] {
  const { width: W, height: H, data } = png;

  // Legend sits bottom-right; activity graph is the bottom strip.
  const yMax = Math.floor(H * 0.9);
  const xLegend = Math.floor(W * 0.72);

  const CELL = 1;
  type Bin = { sx: number; sy: number; n: number; age: number; gSum: number };
  const bins = new Map<string, Bin>();

  for (let y = 12; y < yMax; y++) {
    for (let x = 0; x < W; x++) {
      if (y > H * 0.86 && x > xLegend) continue;
      const i = (y * W + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 120) continue;
      const age = ageFromRgb(r, g, b, periodSec);
      if (age == null) continue;
      const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      const prev = bins.get(key);
      if (!prev) {
        bins.set(key, { sx: x, sy: y, n: 1, age, gSum: g });
      } else {
        prev.sx += x;
        prev.sy += y;
        prev.n += 1;
        // Prefer the newest (smallest age) sample in the cell.
        if (age < prev.age) prev.age = age;
        prev.gSum += g;
      }
    }
  }

  const bandSec = periodSec / COLOR_STEPS;
  const strikes: LightningStrike[] = [];

  for (const bin of bins.values()) {
    const cx = bin.sx / bin.n;
    const cy = bin.sy / bin.n;
    const [baseLon, baseLat] = pxToLonLat(cx, cy, W, H, map);
    if (!inLightningBounds(baseLat, baseLon)) continue;

    // Western / central Australia is sparse on national maps — keep more
    // samples per cell so WA zooms are not empty when the east is lit.
    const western = baseLon < 129;
    const copyCap = western ? 5 : 3;
    const copies = Math.min(copyCap, Math.max(1, Math.ceil(bin.n / (western ? 1 : 2))));
    for (let k = 0; k < copies; k++) {
      const frac = hash01(cx, cy, k);
      const jitterSec = Math.round((frac - 0.5) * bandSec);
      const age = Math.max(0, Math.min(periodSec, bin.age + jitterSec));
      const time = Math.min(nowSec, nowSec - age);
      if (nowSec - time > KEEP_SEC || time > nowSec + 30) continue;

      // Sub-pixel scatter only — do not smear storms across degrees.
      const dLon = ((frac - 0.5) * 1.2 * (map.east - map.west)) / W;
      const dLat =
        (((hash01(cx, cy, k + 3) - 0.5) * 1.2 * (map.south - map.north)) / H);
      const lat = Math.round((baseLat + dLat) * 1e4) / 1e4;
      const lon = Math.round((baseLon + dLon) * 1e4) / 1e4;
      if (!inLightningBounds(lat, lon)) continue;

      const id = `lm-${map.id.slice(0, 2)}${periodSec / 3600}-${lat.toFixed(3)}-${lon.toFixed(3)}-${Math.floor(time / 60)}-${k}`;
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
  map: MapCfg,
  periodH: number,
  now: number,
): Promise<LightningStrike[]> {
  const periodSec = periodH * 60 * 60;
  const res = await fetch(
    `${map.url}&period=${periodH}&bo_t=${Math.floor(now / 20)}`,
    {
      headers: { "User-Agent": USER_AGENT, Accept: "image/png,*/*" },
      // Connect + body; LM can be slow from some regions.
      signal: AbortSignal.timeout(28_000),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`LM map HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 800 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    throw new Error("LM map was not a PNG");
  }
  const png = PNG.sync.read(buf);
  return extractStrikes(png, now, map, periodSec);
}

function dedupeKey(s: LightningStrike): string {
  // ~0.05° / 1 min — collapse multi-map + multi-period twins.
  return `${(s.lat * 20).toFixed(0)}:${(s.lon * 20).toFixed(0)}:${Math.floor(s.time / 60)}`;
}

export async function fetchLightningMapsBackfill(): Promise<MapBackfillResult> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && now - cache.fetchedAt < CACHE_TTL_SEC) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const jobs: Promise<{
        strikes: LightningStrike[];
        priority: number;
        periodH: number;
      }>[] = [];
      for (const map of MAPS) {
        for (const periodH of PERIODS_H) {
          jobs.push(
            (async () => {
              try {
                const strikes = await fetchOneMap(map, periodH, now);
                return { strikes, priority: map.priority, periodH };
              } catch (err) {
                console.error(
                  "LightningMaps backfill map failed",
                  map.id,
                  periodH,
                  err,
                );
                return {
                  strikes: [] as LightningStrike[],
                  priority: map.priority,
                  periodH,
                };
              }
            })(),
          );
        }
      }
      const batches = await Promise.all(jobs);

      // Prefer higher-priority maps and finer (shorter) periods on collision.
      const ranked = batches
        .flatMap((b) =>
          b.strikes.map((s) => ({
            s,
            priority: b.priority,
            // Lower periodH = finer age resolution for recent storms.
            fine: 100 - b.periodH,
          })),
        )
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            b.fine - a.fine ||
            b.s.time - a.s.time,
        );

      const byCell = new Map<string, LightningStrike>();
      for (const { s } of ranked) {
        const key = dedupeKey(s);
        if (!byCell.has(key)) byCell.set(key, s);
      }

      const fresh = [...byCell.values()].filter(
        (s) => now - s.time <= KEEP_SEC,
      );
      // Time + lon-band sample keeps WA coverage and the IR trail intact.
      const strikes = sampleStrikesAcrossTime(fresh, MAX_BACKFILL_STRIKES);
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
