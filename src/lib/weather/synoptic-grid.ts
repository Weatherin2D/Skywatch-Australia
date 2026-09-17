/**
 * Build and fetch a regular MSLP lat/lon grid from Open-Meteo (GFS).
 * Values are true WGS84 — no chart warping required.
 */

export const SYNOPTIC_GRID = {
  west: 105,
  east: 165,
  south: -48,
  north: -5,
  /** Degrees — national MSLP; keep request count under Open-Meteo limits. */
  step: 2.5,
};

export const SYNOPTIC_MODEL = "gfs_seamless";
export const SYNOPTIC_MODEL_LABEL = "GFS";

export type PressureGrid = {
  west: number;
  south: number;
  step: number;
  cols: number;
  rows: number;
  /** Row-major, north→south, west→east. NaN = missing. */
  values: Float64Array;
  /** ISO hour used for this slice (UTC). */
  validTimeIso: string;
  validUnix: number;
  fetchedAt: number;
};

type HourlyLoc = {
  latitude: number;
  longitude: number;
  hourly: { time: string[]; pressure_msl: (number | null)[] };
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function unixToIsoHour(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:00`
  );
}

export function isoHourToUnix(iso: string): number {
  const ms = Date.parse(iso.endsWith("Z") ? iso : `${iso}:00Z`);
  return Math.floor(ms / 1000);
}

export function buildGridCoords() {
  const { west, east, south, north, step } = SYNOPTIC_GRID;
  const lons: number[] = [];
  const lats: number[] = [];
  for (let lon = west; lon <= east + 1e-9; lon = Number((lon + step).toFixed(4))) {
    lons.push(lon);
  }
  // North → south so row 0 is top of map
  for (let lat = north; lat >= south - 1e-9; lat = Number((lat - step).toFixed(4))) {
    lats.push(lat);
  }
  return { lons, lats, cols: lons.length, rows: lats.length };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchBatch(
  lats: number[],
  lons: number[],
  signal?: AbortSignal,
): Promise<HourlyLoc[]> {
  const params = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    hourly: "pressure_msl",
    models: SYNOPTIC_MODEL,
    forecast_days: "2",
    timezone: "UTC",
    cell_selection: "nearest",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(800 * attempt);
    const res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(45_000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) {
      lastErr = new Error("Open-Meteo 429");
      continue;
    }
    if (!res.ok) {
      throw new Error(`Open-Meteo ${res.status}`);
    }
    const json = (await res.json()) as HourlyLoc | HourlyLoc[];
    return Array.isArray(json) ? json : [json];
  }
  throw lastErr ?? new Error("Open-Meteo failed");
}

/** In-memory raw multi-hour grid (shared across requests). */
type RawCache = {
  lons: number[];
  lats: number[];
  /** location index → hourly pressures aligned to `times` */
  series: (number | null)[][];
  times: string[];
  fetchedAt: number;
};

let rawCache: RawCache | null = null;
const RAW_TTL_MS = 45 * 60 * 1000;
const BATCH = 70;

export async function loadRawPressureField(
  signal?: AbortSignal,
): Promise<RawCache> {
  if (rawCache && Date.now() - rawCache.fetchedAt < RAW_TTL_MS) {
    return rawCache;
  }
  const { lons, lats } = buildGridCoords();
  const flatLats: number[] = [];
  const flatLons: number[] = [];
  for (const lat of lats) {
    for (const lon of lons) {
      flatLats.push(lat);
      flatLons.push(lon);
    }
  }

  const series: (number | null)[][] = new Array(flatLats.length);
  let times: string[] = [];

  for (let i = 0; i < flatLats.length; i += BATCH) {
    if (i > 0) await sleep(350);
    const batchLats = flatLats.slice(i, i + BATCH);
    const batchLons = flatLons.slice(i, i + BATCH);
    const locs = await fetchBatch(batchLats, batchLons, signal);
    if (times.length === 0 && locs[0]?.hourly?.time) {
      times = locs[0].hourly.time;
    }
    for (let j = 0; j < locs.length; j++) {
      series[i + j] = locs[j]?.hourly?.pressure_msl ?? [];
    }
  }

  rawCache = {
    lons,
    lats,
    series: series as (number | null)[][],
    times,
    fetchedAt: Date.now(),
  };
  return rawCache;
}

/** Pick the forecast hour closest to `refUnix` (prefer at-or-before). */
export function pickHourIndex(times: string[], refUnix: number): number {
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const u = isoHourToUnix(times[i]!);
    const delta = refUnix - u;
    // Prefer past/equal; small penalty for future
    const score = delta >= 0 ? delta : Math.abs(delta) + 3600;
    if (score < bestDelta) {
      bestDelta = score;
      best = i;
    }
  }
  return best;
}

export async function getPressureGridAt(
  refUnix: number,
  signal?: AbortSignal,
): Promise<PressureGrid> {
  const raw = await loadRawPressureField(signal);
  const hourIdx = pickHourIndex(raw.times, refUnix);
  const validTimeIso = raw.times[hourIdx]!;
  const values = new Float64Array(raw.lats.length * raw.lons.length);
  for (let i = 0; i < values.length; i++) {
    const v = raw.series[i]?.[hourIdx];
    values[i] = v == null || !Number.isFinite(v) ? Number.NaN : v;
  }
  return {
    west: raw.lons[0]!,
    south: raw.lats[raw.lats.length - 1]!,
    step: SYNOPTIC_GRID.step,
    cols: raw.lons.length,
    rows: raw.lats.length,
    values,
    validTimeIso,
    validUnix: isoHourToUnix(validTimeIso),
    fetchedAt: raw.fetchedAt,
  };
}

export function listAvailableHours(raw: RawCache): string[] {
  return raw.times;
}
