/**
 * CloudCountry storm cells — cluster live lightning into tracked cells with
 * short motion vectors. Radar timestamps are used as the valid-time spine;
 * detection is lightning-density based (RainViewer tiles are not a full grid).
 *
 * Server-only module (Blitzortung feed). Client code must import types/geo
 * from `@/lib/weather/storm-cell-types`.
 */

import type { LightningStrike } from "@/lib/weather/lightning";
import { LIGHTNING_AU_BOUNDS } from "@/lib/weather/lightning";
import { getLiveLightningSnapshot } from "@/lib/weather/blitzortung-feed";
import { AU_TOWNS } from "@/lib/weather/au-towns";
import {
  alertLevelFromScore,
  bearingBetween,
  compassLabel,
  destinationPoint,
  distanceKm,
  formatThreatTownsLine,
  type StormCell,
  type StormCellAlert,
  type StormCellProjectedPoint,
  type StormCellThreatTown,
  type StormCellTrackPoint,
  type StormCellsPayload,
} from "@/lib/weather/storm-cell-types";

export type {
  StormCell,
  StormCellAlert,
  StormCellAlertLevel,
  StormCellProjectedPoint,
  StormCellThreatTown,
  StormCellTrackPoint,
  StormCellsPayload,
} from "@/lib/weather/storm-cell-types";
export {
  alertLevelFromScore,
  bearingBetween,
  compassLabel,
  destinationPoint,
  distanceKm,
  formatThreatEta,
  formatThreatTownsLine,
} from "@/lib/weather/storm-cell-types";

const CELL_GRID_DEG = 0.55;
const MIN_STRIKES_15 = 4;
const MAX_CELLS = 18;
const WINDOW_15 = 15 * 60;
const WINDOW_45 = 45 * 60;
const WINDOW_OLD = 45 * 60;
const WINDOW_MID = 25 * 60;
const PROJECT_MINUTES = [15, 30, 60] as const;
/** Towns within this radius of the cell / track count as a hit. */
const TOWN_HIT_RADIUS_KM = 50;
/** Ignore hamlets so alerts stay readable. */
const MIN_TOWN_POPULATION = 1500;
const MAX_THREAT_TOWNS = 8;
/** Only consider towns roughly ahead of motion (degrees). */
const AHEAD_BEARING_DEG = 55;
const MAX_ETA_MINUTES = 90;

const STATE_ABBR: Record<string, string> = {
  "New South Wales": "NSW",
  Victoria: "VIC",
  Queensland: "QLD",
  "Western Australia": "WA",
  "South Australia": "SA",
  Tasmania: "TAS",
  "Northern Territory": "NT",
  "Australian Capital Territory": "ACT",
};

function stateAbbr(state: string): string {
  return STATE_ABBR[state] ?? state;
}

function cellKey(lat: number, lon: number): string {
  const i = Math.floor(lat / CELL_GRID_DEG);
  const j = Math.floor(lon / CELL_GRID_DEG);
  return `${i}:${j}`;
}

function stableCellId(key: string): string {
  return `cell-${key.replace(":", "x")}`;
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

function bucketStrikes(strikes: LightningStrike[]): Map<string, Bucket> {
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
    let seedKey = start;
    const acc: Bucket = {
      key: start,
      latSum: 0,
      lonSum: 0,
      n: 0,
      maxI: 0,
      tSum: 0,
    };
    let bestN = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const b = buckets.get(k);
      if (!b) continue;
      if (b.n > bestN) {
        bestN = b.n;
        seedKey = k;
      }
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
    if (acc.n > 0) {
      acc.key = seedKey;
      groups.push(acc);
    }
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

function projectPath(
  lat: number,
  lon: number,
  motionDeg: number | null,
  speedKmh: number | null,
): StormCellProjectedPoint[] {
  if (
    motionDeg == null ||
    speedKmh == null ||
    !Number.isFinite(speedKmh) ||
    speedKmh < 2
  ) {
    return [];
  }
  return PROJECT_MINUTES.map((minutesAhead) => {
    const dist = (speedKmh * minutesAhead) / 60;
    const p = destinationPoint(lat, lon, motionDeg, dist);
    return {
      lat: Math.round(p.lat * 1000) / 1000,
      lon: Math.round(p.lon * 1000) / 1000,
      minutesAhead,
    };
  });
}

function bearingDiffDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Towns the cell is over now, or expected to approach along its motion track.
 * ETA uses along-track distance / speed when motion is known.
 */
function findThreatTowns(
  lat: number,
  lon: number,
  motionDeg: number | null,
  speedKmh: number | null,
  projectedPath: StormCellProjectedPoint[],
): StormCellThreatTown[] {
  const samples: StormCellProjectedPoint[] = [
    { lat, lon, minutesAhead: 0 },
    ...projectedPath,
  ];
  // Denser samples between projection nodes for better town catch.
  if (
    motionDeg != null &&
    speedKmh != null &&
    Number.isFinite(speedKmh) &&
    speedKmh >= 2
  ) {
    for (let m = 10; m <= 75; m += 10) {
      if (PROJECT_MINUTES.includes(m as (typeof PROJECT_MINUTES)[number])) {
        continue;
      }
      const dist = (speedKmh * m) / 60;
      const p = destinationPoint(lat, lon, motionDeg, dist);
      samples.push({
        lat: Math.round(p.lat * 1000) / 1000,
        lon: Math.round(p.lon * 1000) / 1000,
        minutesAhead: m,
      });
    }
  }

  const hits = new Map<string, StormCellThreatTown & { population: number }>();

  for (const town of AU_TOWNS) {
    if (town.population < MIN_TOWN_POPULATION) continue;

    let nearSample: StormCellProjectedPoint | null = null;
    let nearDist = Infinity;
    for (const sample of samples) {
      const d = distanceKm(sample.lat, sample.lon, town.lat, town.lon);
      if (d > TOWN_HIT_RADIUS_KM) continue;
      if (
        !nearSample ||
        sample.minutesAhead < nearSample.minutesAhead ||
        (sample.minutesAhead === nearSample.minutesAhead && d < nearDist)
      ) {
        nearSample = sample;
        nearDist = d;
      }
    }
    if (!nearSample) continue;

    let minutesAhead = nearSample.minutesAhead;
    if (
      motionDeg != null &&
      speedKmh != null &&
      Number.isFinite(speedKmh) &&
      speedKmh >= 2
    ) {
      const distNow = distanceKm(lat, lon, town.lat, town.lon);
      if (distNow <= TOWN_HIT_RADIUS_KM) {
        minutesAhead = 0;
      } else {
        const bearingToTown = bearingBetween(lat, lon, town.lat, town.lon);
        const diff = bearingDiffDeg(bearingToTown, motionDeg);
        if (diff > AHEAD_BEARING_DEG) {
          // Close to a future sample but not ahead of current motion — keep sample ETA
          // only if sample is already ahead; otherwise skip behind-track towns.
          if (nearSample.minutesAhead === 0) continue;
        } else {
          const alongTrack =
            distNow * Math.cos((diff * Math.PI) / 180);
          const crossTrack = Math.abs(
            distNow * Math.sin((diff * Math.PI) / 180),
          );
          if (crossTrack > TOWN_HIT_RADIUS_KM || alongTrack < -8) continue;
          minutesAhead = Math.max(
            0,
            Math.round((alongTrack / speedKmh) * 60),
          );
        }
      }
    }

    if (minutesAhead > MAX_ETA_MINUTES) continue;

    const key = `${town.name}|${town.state}`;
    const next: StormCellThreatTown & { population: number } = {
      name: town.name,
      state: stateAbbr(town.state),
      lat: town.lat,
      lon: town.lon,
      minutesAhead,
      distanceKm: Math.round(nearDist * 10) / 10,
      population: town.population,
    };
    const prev = hits.get(key);
    if (
      !prev ||
      next.minutesAhead < prev.minutesAhead ||
      (next.minutesAhead === prev.minutesAhead &&
        next.population > prev.population)
    ) {
      hits.set(key, next);
    }
  }

  return [...hits.values()]
    .sort(
      (a, b) =>
        a.minutesAhead - b.minutesAhead ||
        b.population - a.population ||
        a.distanceKm - b.distanceKm,
    )
    .slice(0, MAX_THREAT_TOWNS)
    .map(({ population: _p, ...town }) => town);
}

function buildScore(opts: {
  strikes15m: number;
  ratePerMin: number;
  maxIntensity: number;
  speedKmh: number | null;
  strikes45m: number;
}): { strength: number; score: number } {
  const rateTerm = Math.min(1, opts.ratePerMin / 6);
  const countTerm = Math.min(1, opts.strikes15m / 35);
  const intensityTerm = Math.min(1, opts.maxIntensity / 70);
  const motionTerm =
    opts.speedKmh != null && opts.speedKmh >= 5
      ? Math.min(1, opts.speedKmh / 60) * 0.15
      : 0;
  // Sustained activity: 45m count vs 15m burst
  const sustain =
    opts.strikes45m > 0
      ? Math.min(1, opts.strikes15m / Math.max(1, opts.strikes45m / 2)) * 0.1
      : 0;
  const strength = Math.min(
    1,
    countTerm * 0.35 + rateTerm * 0.35 + intensityTerm * 0.2 + motionTerm + sustain,
  );
  const score = Math.max(1, Math.min(100, Math.round(strength * 100)));
  return { strength: Math.round(strength * 100) / 100, score };
}

function buildAnalysis(opts: {
  label: string;
  strikes15m: number;
  strikes45m: number;
  ratePerMin: number;
  motionDeg: number | null;
  speedKmh: number | null;
  score: number;
  alertLevel: ReturnType<typeof alertLevelFromScore>;
  threatTowns: StormCellThreatTown[];
}): { analysis: string[]; summary: string } {
  const analysis: string[] = [];
  const burstRatio =
    opts.strikes45m > 0 ? opts.strikes15m / (opts.strikes45m / 3) : 1;
  if (burstRatio >= 1.35) {
    analysis.push("Lightning rate is increasing over the last 15 minutes.");
  } else if (burstRatio <= 0.65 && opts.strikes45m >= 12) {
    analysis.push("Activity is easing versus the prior half-hour.");
  } else {
    analysis.push("Lightning rate is holding roughly steady.");
  }

  if (opts.speedKmh != null && opts.motionDeg != null && opts.speedKmh >= 5) {
    analysis.push(
      `Estimated motion ${compassLabel(opts.motionDeg)} at ~${Math.round(opts.speedKmh)} km/h (projected 30–60 min path available).`,
    );
  } else {
    analysis.push("Motion is uncertain — projected path unavailable.");
  }

  analysis.push(
    `${opts.strikes15m} strikes in 15 min (${opts.ratePerMin}/min) near ${opts.label}.`,
  );

  const nowTowns = opts.threatTowns.filter((t) => t.minutesAhead <= 5);
  const soonTowns = opts.threatTowns.filter((t) => t.minutesAhead > 5);
  if (nowTowns.length) {
    analysis.push(`Near ${formatThreatTownsLine(nowTowns, 5)} right now.`);
  }
  if (soonTowns.length) {
    analysis.push(
      `Expected to approach ${formatThreatTownsLine(soonTowns, 5)}.`,
    );
  } else if (!nowTowns.length) {
    analysis.push("No larger towns on the near-term projected track.");
  }

  if (opts.alertLevel === "warning") {
    analysis.push(
      "CloudCountry Warning — intense lightning cell; treat as elevated thunderstorm risk in the vicinity.",
    );
  } else if (opts.alertLevel === "watch") {
    analysis.push(
      "CloudCountry Watch — active thunderstorm cell; monitor nearby places along the track.",
    );
  } else {
    analysis.push("Below automated alert threshold — guidance only.");
  }

  const levelWord =
    opts.alertLevel === "warning"
      ? "Warning"
      : opts.alertLevel === "watch"
        ? "Watch"
        : "Cell";
  const townBit = formatThreatTownsLine(opts.threatTowns, 3);
  const summary = townBit
    ? `${levelWord} · score ${opts.score}/100 · ${opts.ratePerMin}/min near ${opts.label} · ${townBit}`
    : `${levelWord} · score ${opts.score}/100 · ${opts.ratePerMin}/min near ${opts.label}`;
  return { analysis, summary };
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
    .map((g) => {
      const c = centroid(g);
      const label = labelFor(c.lat, c.lon);
      let prev: { lat: number; lon: number; time: number } | null = null;
      let bestD = Infinity;
      for (const og of oldGroups) {
        const oc = centroid(og);
        const d = distanceKm(c.lat, c.lon, oc.lat, oc.lon);
        if (d < bestD && d < 80) {
          bestD = d;
          prev = oc;
        }
      }
      let mid: { lat: number; lon: number; time: number } | null = null;
      let bestMid = Infinity;
      for (const mg of midGroups) {
        const mc = centroid(mg);
        const d = distanceKm(c.lat, c.lon, mc.lat, mc.lon);
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
        const dist = distanceKm(from.lat, from.lon, c.lat, c.lon);
        motionDeg = Math.round(bearingBetween(from.lat, from.lon, c.lat, c.lon));
        speedKmh = Math.round((dist / dtH) * 10) / 10;
      }

      const strikes45m = recent45.filter(
        (s) => distanceKm(s.lat, s.lon, c.lat, c.lon) < 35,
      ).length;
      const rate = Math.round((g.n / 15) * 10) / 10;
      const { strength, score } = buildScore({
        strikes15m: g.n,
        ratePerMin: rate,
        maxIntensity: g.maxI,
        speedKmh,
        strikes45m,
      });
      const alertLevel = alertLevelFromScore(score);
      const projectedPath = projectPath(c.lat, c.lon, motionDeg, speedKmh);
      const threatTowns = findThreatTowns(
        c.lat,
        c.lon,
        motionDeg,
        speedKmh,
        projectedPath,
      );
      const { analysis, summary } = buildAnalysis({
        label,
        strikes15m: g.n,
        strikes45m,
        ratePerMin: rate,
        motionDeg,
        speedKmh,
        score,
        alertLevel,
        threatTowns,
      });

      return {
        id: stableCellId(g.key),
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
        projectedPath,
        threatTowns,
        strength,
        score,
        alertLevel,
        analysis,
        summary,
      } satisfies StormCell;
    })
    .sort((a, b) => b.score - a.score || b.strikes15m - a.strikes15m)
    .slice(0, MAX_CELLS);

  const alerts: StormCellAlert[] = cells
    .filter((c) => c.alertLevel !== "none")
    .map((c) => ({
      id: c.id,
      score: c.score,
      alertLevel: c.alertLevel as Exclude<typeof c.alertLevel, "none">,
      label: c.label,
      lat: c.lat,
      lon: c.lon,
      summary: c.summary,
      threatTowns: c.threatTowns,
      href: `/warnings/auto/${encodeURIComponent(c.id)}`,
    }));

  return {
    generated: nowSec,
    status: "ok",
    radarValidTime,
    cells,
    alerts,
    attribution: "Blitzortung / LightningMaps · RainViewer timing",
    note: "CloudCountry guidance — cells from lightning clusters, not official BoM tracks.",
  };
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

/** Lookup a single cell by id from a fresh payload. */
export async function fetchStormCellById(
  id: string,
): Promise<StormCell | null> {
  const payload = await fetchStormCells();
  return payload.cells.find((c) => c.id === id) ?? null;
}
