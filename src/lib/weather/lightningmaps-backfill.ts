/**
 * Backfill recent Australian strikes from LightningMaps.org static maps.
 *
 * Blitzortung's live socket under-delivers Oceania; LightningMaps still renders
 * the last 2h of strokes on its Australia PNG. We sample bright strike pixels,
 * georeference them, and merge into the live buffer.
 */

import { PNG } from "pngjs";
import type { LightningStrike } from "@/lib/weather/lightning";
import { inLightningBounds } from "@/lib/weather/blitzortung-parse";

const MAP_URL =
  "https://images.lightningmaps.org/blitzortung/oceania/index.php?map=australia";

/**
 * Equirectangular bounds for the LightningMaps "australia" static map
 * (670×566). Calibrated so Perth (~115.9E, 32S) and Sydney (~151.2E, 34S)
 * sit under their labels on the published basemap.
 */
const MAP_BOUNDS = {
  west: 110,
  east: 155,
  north: -10,
  south: -45,
  width: 670,
  height: 566,
} as const;

const USER_AGENT = "SkyWatchAustralia/1.0";

export type MapBackfillResult = {
  strikes: LightningStrike[];
  fetchedAt: number;
};

function pxToLonLat(x: number, y: number): [number, number] {
  const lon =
    MAP_BOUNDS.west +
    ((MAP_BOUNDS.east - MAP_BOUNDS.west) * x) / MAP_BOUNDS.width;
  const lat =
    MAP_BOUNDS.north +
    ((MAP_BOUNDS.south - MAP_BOUNDS.north) * y) / MAP_BOUNDS.height;
  return [lon, lat];
}

/** Map LM strike colours → approximate age. Bright red/orange = newest. */
function ageFromColor(r: number, g: number, b: number): number {
  // Pure bright red / orange flashes are the most recent on LM 2h maps
  if (r >= 240 && g <= 40) return 3 * 60;
  if (r >= 240 && g <= 120) return 10 * 60;
  if (r >= 240 && g <= 200) return 20 * 60;
  if (r > 200 && g > 150) return 8 * 60; // yellow/white-ish
  return 25 * 60;
}

function extractStrikes(png: PNG, nowSec: number): LightningStrike[] {
  const { width: W, height: H, data } = png;
  const hits: Array<{ x: number; y: number; r: number; g: number; b: number }> =
    [];

  // Skip title bar + legend (bottom-right activity graph)
  const yMax = Math.floor(H * 0.92);
  const xMax = Math.floor(W * 0.88);

  for (let y = 30; y < yMax; y++) {
    for (let x = 0; x < xMax; x++) {
      const i = (y * W + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 200) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      // Strike dots: bright saturated red/orange/yellow (not muted basemap browns)
      if (sat < 100 || max < 200) continue;
      if (b > r + 30 && b > g + 20) continue;
      if (g > r + 40 && g > b + 20) continue;
      if (r < 200) continue;
      // Reject muddy browns used for labels/cities
      if (r < 230 && g > 60 && g < 120 && b < 60) continue;
      hits.push({ x, y, r, g, b });
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
        if (Math.hypot(a.x - b.x, a.y - b.y) <= 5) {
          used[j] = 1;
          q.push(j);
          pts.push(b);
        }
      }
    }
    if (pts.length < 2 || pts.length > 40) continue; // noise / labels
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const [lon, lat] = pxToLonLat(cx, cy);
    if (!inLightningBounds(lat, lon)) continue;
    const avgR = pts.reduce((s, p) => s + p.r, 0) / pts.length;
    const avgG = pts.reduce((s, p) => s + p.g, 0) / pts.length;
    const avgB = pts.reduce((s, p) => s + p.b, 0) / pts.length;
    const age = ageFromColor(avgR, avgG, avgB);
    const time = nowSec - age;
    const id = `lm-${lat.toFixed(3)}-${lon.toFixed(3)}-${Math.floor(time / 300)}`;
    strikes.push({
      id,
      time,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      polarity: 0,
      intensity: 24,
    });
  }

  return strikes;
}

let cache: MapBackfillResult | null = null;
let inflight: Promise<MapBackfillResult> | null = null;

export async function fetchLightningMapsBackfill(): Promise<MapBackfillResult> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && now - cache.fetchedAt < 55) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${MAP_URL}&bo_t=${Math.floor(now / 60)}`, {
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
      const strikes = extractStrikes(png, now).filter(
        (s) => now - s.time <= 30 * 60,
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
