/**
 * Build and fetch MSLP + temperature + wind grids from Open-Meteo (GFS).
 * Values are true WGS84 — no chart warping required.
 */

export const SYNOPTIC_GRID = {
  west: 105,
  east: 165,
  south: -48,
  north: -5,
  /** Degrees — national field; keep request count under Open-Meteo limits. */
  step: 2.5,
};

export const SYNOPTIC_MODEL = "gfs_seamless";
export const SYNOPTIC_MODEL_LABEL = "GFS";

export type ScalarGrid = {
  west: number;
  south: number;
  step: number;
  cols: number;
  rows: number;
  /** Row-major, north→south, west→east. NaN = missing. */
  values: Float64Array;
};

export type PressureGrid = ScalarGrid & {
  validTimeIso: string;
  validUnix: number;
  fetchedAt: number;
};

/** Full analysis slice used for isobars + fronts. */
export type SynopticField = PressureGrid & {
  temperatureC: Float64Array;
  /** Wind speed m/s */
  windSpeed: Float64Array;
  /** Meteorological wind direction degrees (from which the wind blows). */
  windFromDeg: Float64Array;
};

type HourlyLoc = {
  latitude: number;
  longitude: number;
  hourly: {
    time: string[];
    pressure_msl: (number | null)[];
    temperature_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
  };
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
    hourly:
      "pressure_msl,temperature_2m,wind_speed_10m,wind_direction_10m",
    models: SYNOPTIC_MODEL,
    forecast_days: "2",
    timezone: "UTC",
    cell_selection: "nearest",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(900 * attempt);
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

type RawCache = {
  lons: number[];
  lats: number[];
  pressure: (number | null)[][];
  temperature: (number | null)[][];
  windSpeed: (number | null)[][];
  windFrom: (number | null)[][];
  times: string[];
  fetchedAt: number;
  version: number;
};

let rawCache: RawCache | null = null;
/** Bump when variable set / grid changes so stale in-memory cache is dropped. */
const CACHE_VERSION = 3;
const RAW_TTL_MS = 45 * 60 * 1000;
const BATCH = 70;

export async function loadRawPressureField(
  signal?: AbortSignal,
): Promise<RawCache> {
  if (
    rawCache &&
    rawCache.version === CACHE_VERSION &&
    Date.now() - rawCache.fetchedAt < RAW_TTL_MS
  ) {
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

  const n = flatLats.length;
  const pressure: (number | null)[][] = new Array(n);
  const temperature: (number | null)[][] = new Array(n);
  const windSpeed: (number | null)[][] = new Array(n);
  const windFrom: (number | null)[][] = new Array(n);
  let times: string[] = [];

  for (let i = 0; i < n; i += BATCH) {
    if (i > 0) await sleep(350);
    const batchLats = flatLats.slice(i, i + BATCH);
    const batchLons = flatLons.slice(i, i + BATCH);
    const locs = await fetchBatch(batchLats, batchLons, signal);
    if (times.length === 0 && locs[0]?.hourly?.time) {
      times = locs[0].hourly.time;
    }
    for (let j = 0; j < locs.length; j++) {
      const h = locs[j]?.hourly;
      pressure[i + j] = h?.pressure_msl ?? [];
      temperature[i + j] = h?.temperature_2m ?? [];
      windSpeed[i + j] = h?.wind_speed_10m ?? [];
      windFrom[i + j] = h?.wind_direction_10m ?? [];
    }
  }

  rawCache = {
    lons,
    lats,
    pressure,
    temperature,
    windSpeed,
    windFrom,
    times,
    fetchedAt: Date.now(),
    version: CACHE_VERSION,
  };
  return rawCache;
}

export function pickHourIndex(times: string[], refUnix: number): number {
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const u = isoHourToUnix(times[i]!);
    const delta = refUnix - u;
    const score = delta >= 0 ? delta : Math.abs(delta) + 3600;
    if (score < bestDelta) {
      bestDelta = score;
      best = i;
    }
  }
  return best;
}

function sliceSeries(
  series: (number | null)[][],
  hourIdx: number,
  len: number,
): Float64Array {
  const values = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const v = series[i]?.[hourIdx];
    values[i] = v == null || !Number.isFinite(v) ? Number.NaN : v;
  }
  return values;
}

export async function getSynopticFieldAt(
  refUnix: number,
  signal?: AbortSignal,
): Promise<SynopticField> {
  const raw = await loadRawPressureField(signal);
  const hourIdx = pickHourIndex(raw.times, refUnix);
  const validTimeIso = raw.times[hourIdx]!;
  const len = raw.lats.length * raw.lons.length;
  return {
    west: raw.lons[0]!,
    south: raw.lats[raw.lats.length - 1]!,
    step: SYNOPTIC_GRID.step,
    cols: raw.lons.length,
    rows: raw.lats.length,
    values: sliceSeries(raw.pressure, hourIdx, len),
    temperatureC: sliceSeries(raw.temperature, hourIdx, len),
    windSpeed: sliceSeries(raw.windSpeed, hourIdx, len),
    windFromDeg: sliceSeries(raw.windFrom, hourIdx, len),
    validTimeIso,
    validUnix: isoHourToUnix(validTimeIso),
    fetchedAt: raw.fetchedAt,
  };
}

/** @deprecated Use getSynopticFieldAt — kept for callers that only need MSLP. */
export async function getPressureGridAt(
  refUnix: number,
  signal?: AbortSignal,
): Promise<PressureGrid> {
  const field = await getSynopticFieldAt(refUnix, signal);
  return {
    west: field.west,
    south: field.south,
    step: field.step,
    cols: field.cols,
    rows: field.rows,
    values: field.values,
    validTimeIso: field.validTimeIso,
    validUnix: field.validUnix,
    fetchedAt: field.fetchedAt,
  };
}

export function listAvailableHours(raw: RawCache): string[] {
  return raw.times;
}
