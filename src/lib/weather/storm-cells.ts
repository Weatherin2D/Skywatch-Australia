/**
 * SkyWatch storm cells — cluster live lightning into tracked cells with
 * short motion vectors. Radar timestamps are used as the valid-time spine;
 * detection is lightning-density based (RainViewer tiles are not a full grid).
 */

import type { LightningStrike } from "@/lib/weather/lightning";
import { LIGHTNING_AU_BOUNDS } from "@/lib/weather/lightning";
import { getLiveLightningSnapshot } from "@/lib/weather/blitzortung-feed";

export type StormCellTrackPoint = {
  lat: number;
  lon: number;
  time: number;
};

export type StormCell = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Strikes in the recent 15-minute window */
  strikes15m: number;
  /** Strikes in the recent 45-minute window */
  strikes45m: number;
  ratePerMin: number;
  maxIntensity: number;
  /** Motion toward next estimated position (degrees from north, meteorological) */
  motionDeg: number | null;
  /** Speed km/h from centroid drift */
  speedKmh: number | null;
  /** Short trail: older → newer */
  track: StormCellTrackPoint[];
  /** 0–1 severity score for HUD sorting */
  strength: number;
};

export type StormCellsPayload = {
  generated: number;
  status: string;
  radarValidTime: number | null;
  cells: StormCell[];
  attribution: string;
  note: string;
};

const CELL_GRID_DEG = 0.55;
const MIN_STRIKES_15 = 4;
const MAX_CELLS = 18;
const WINDOW_15 = 15 * 60;
const WINDOW_45 = 45 * 60;
const WINDOW_OLD = 45 * 60;
const WINDOW_MID = 25 * 60;

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function cellKey(lat: number, lon: number): string {
  const i = Math.floor(lat / CELL_GRID_DEG);
  const j = Math.floor(lon / CELL_GRID_DEG);
  return `${i}:${j}`;
}

function labelFor(lat: number, lon: number): string {
  if (lat > -16 && lon > 141 && lon < 146) return "far north QLD";
  if (lat > -22 && lat <= -16 && lon > 144) return "north QLD";
  if (lat > -29 && lat <= -22 && lon > 150) return "SE QLD";
  if (lat > -35 && lat <= -28 && lon > 149) return "eastern NSW";
  if (lat > -38 && lat <= -35 && lon > 147) return "southern NSW";
  if (lat > -39.5 && lat <= -36 && lon > 146) return "eastern VIC";
  if (lat > -39 && lat <= -36 && lon > 142 && lon <= 146) return "central VIC";
  if (lat > -44 && lat <= -40) return "TAS";
  if (lon > 132 && lon < 141 && lat > -38 && lat < -30) return "SA";
  if (lon < 125 && lat < -30) return "southern WA";
  if (lon < 128 && lat > -25) return "NW WA";
  if (lat > -16 && lon > 129 && lon < 138) return "Top End NT";
  if (lon > 150) return "Coral Sea";
  if (lat > -20) return "northern Australia";
  return "inland Australia";
}

type Bucket = {
  key: string;
  latSum: number;
  lonSum: number;
  n: number;
  maxI: number;
  tSum: number;
};

function bucketStrikes(
  strikes: LightningStrike[],
): Map<string, Bucket> {
  const map = new Map<string, Bucket>();
  for (const s of strikes) {
    if (
      s.lat < LIGHTNING_AU_BOUNDS.south ||
      s.lat > LIGHTNING_AU_BOUNDS.north ||
      s.lon < LIGHTNING_AU_BOUNDS.west ||
      s.lon > LIGHTNING_AU_BOUNDS.east
    ) {
      continue;
    }
    const key = cellKey(s.lat, s.lon);
    let b = map.get(key);
    if (!b) {
      b = { key, latSum: 0, lonSum: 0, n: 0, maxI: 0, tSum: 0 };
      map.set(key, b);
    }
    b.latSum += s.lat;
    b.lonSum += s.lon;
    b.n += 1;
    b.tSum += s.time;
    b.maxI = Math.max(b.maxI, Math.abs(s.intensity || 0));
  }
  return map;
}

/** Merge adjacent grid buckets into connected components. */
function mergeBuckets(buckets: Map<string, Bucket>): Bucket[] {
  const keys = [...buckets.keys()];
  const visited = new Set<string>();
  const groups: Bucket[] = [];

  for (const start of keys) {
    if (visited.has(start)) continue;
    const stack = [start];
    visited.add(start);
    const acc: Bucket = {
      key: start,
      latSum: 0,
      lonSum: 0,
      n: 0,
      maxI: 0,
      tSum: 0,
    };
    while (stack.length) {
      const k = stack.pop()!;
      const b = buckets.get(k);
      if (!b) continue;
      acc.latSum += b.latSum;
      acc.lonSum += b.lonSum;
      acc.n += b.n;
      acc.tSum += b.tSum;
      acc.maxI = Math.max(acc.maxI, b.maxI);
      const [ii, jj] = k.split(":").map(Number) as [number, number];
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (di === 0 && dj === 0) continue;
          const nk = `${ii + di}:${jj + dj}`;
          if (!buckets.has(nk) || visited.has(nk)) continue;
          visited.add(nk);
          stack.push(nk);
        }
      }
    }
    if (acc.n > 0) groups.push(acc);
  }
  return groups;
}

function centroid(b: Bucket): { lat: number; lon: number; time: number } {
  return {
    lat: b.latSum / b.n,
    lon: b.lonSum / b.n,
    time: Math.round(b.tSum / b.n),
  };
}

export function buildStormCells(
  strikes: LightningStrike[],
  nowSec = Math.floor(Date.now() / 1000),
  radarValidTime: number | null = null,
): StormCellsPayload {
  const cut15 = nowSec - WINDOW_15;
  const cut45 = nowSec - WINDOW_45;
  const cutOldStart = nowSec - WINDOW_OLD;
  const cutOldEnd = nowSec - WINDOW_MID;
  const cutNewStart = nowSec - WINDOW_MID;

  const recent45 = strikes.filter(
    (s) => s.time >= cut45 && s.time <= nowSec + 60,
  );
  const recent15 = recent45.filter((s) => s.time >= cut15);
  const older = recent45.filter(
    (s) => s.time >= cutOldStart && s.time < cutOldEnd,
  );
  const newer = recent45.filter((s) => s.time >= cutNewStart);

  const nowGroups = mergeBuckets(bucketStrikes(recent15)).filter(
    (g) => g.n >= MIN_STRIKES_15,
  );
  const oldGroups = mergeBuckets(bucketStrikes(older));
  const midGroups = mergeBuckets(bucketStrikes(newer));

  const cells: StormCell[] = nowGroups
    .map((g, idx) => {
      const c = centroid(g);
      const label = labelFor(c.lat, c.lon);
      // Match to older / mid centroids for motion.
      let prev: { lat: number; lon: number; time: number } | null = null;
      let bestD = Infinity;
      for (const og of oldGroups) {
        const oc = centroid(og);
        const d = haversineKm(c.lat, c.lon, oc.lat, oc.lon);
        if (d < bestD && d < 80) {
          bestD = d;
          prev = oc;
        }
      }
      let mid: { lat: number; lon: number; time: number } | null = null;
      let bestMid = Infinity;
      for (const mg of midGroups) {
        const mc = centroid(mg);
        const d = haversineKm(c.lat, c.lon, mc.lat, mc.lon);
        if (d < bestMid && d < 60) {
          bestMid = d;
          mid = mc;
        }
      }

      const track: StormCellTrackPoint[] = [];
      if (prev) track.push({ lat: prev.lat, lon: prev.lon, time: prev.time });
      if (mid) track.push({ lat: mid.lat, lon: mid.lon, time: mid.time });
      track.push({ lat: c.lat, lon: c.lon, time: c.time });

      let motionDeg: number | null = null;
      let speedKmh: number | null = null;
      const from = prev ?? mid;
      if (from) {
        const dtH = Math.max(0.15, (c.time - from.time) / 3600);
        const dist = haversineKm(from.lat, from.lon, c.lat, c.lon);
        motionDeg = Math.round(bearingDeg(from.lat, from.lon, c.lat, c.lon));
        speedKmh = Math.round((dist / dtH) * 10) / 10;
      }

      const strikes45m = recent45.filter(
        (s) => haversineKm(s.lat, s.lon, c.lat, c.lon) < 35,
      ).length;
      const rate = Math.round((g.n / 15) * 10) / 10;
      const strength = Math.min(
        1,
        g.n / 40 + rate / 8 + Math.min(1, g.maxI / 80) * 0.25,
      );

      return {
        id: `cell-${idx}-${Math.round(c.lat * 100)}-${Math.round(c.lon * 100)}`,
        label,
        lat: Math.round(c.lat * 1000) / 1000,
        lon: Math.round(c.lon * 1000) / 1000,
        strikes15m: g.n,
        strikes45m,
        ratePerMin: rate,
        maxIntensity: Math.round(g.maxI),
        motionDeg,
        speedKmh,
        track,
        strength: Math.round(strength * 100) / 100,
      } satisfies StormCell;
    })
    .sort((a, b) => b.strength - a.strength || b.strikes15m - a.strikes15m)
    .slice(0, MAX_CELLS);

  return {
    generated: nowSec,
    status: "ok",
    radarValidTime,
    cells,
    attribution: "Blitzortung / LightningMaps · RainViewer timing",
    note: "SkyWatch guidance — cells from lightning clusters, not official BoM tracks.",
  };
}

export function bearingBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return bearingDeg(lat1, lon1, lat2, lon2);
}

export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return haversineKm(lat1, lon1, lat2, lon2);
}

async function fetchRadarTipUnix(): Promise<number | null> {
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      radar?: { past?: { time?: number }[] };
    };
    const past = json.radar?.past ?? [];
    const last = past[past.length - 1];
    return typeof last?.time === "number" ? last.time : null;
  } catch {
    return null;
  }
}

export async function fetchStormCells(): Promise<StormCellsPayload> {
  const [snap, radarValidTime] = await Promise.all([
    getLiveLightningSnapshot(),
    fetchRadarTipUnix(),
  ]);
  const payload = buildStormCells(snap.strikes, undefined, radarValidTime);
  return {
    ...payload,
    status: snap.status === "error" ? "degraded" : "ok",
    attribution: `${snap.attribution || "Blitzortung"} · RainViewer timing`,
  };
}
