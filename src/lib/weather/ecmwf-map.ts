/**
 * Hourly ECMWF IFS national map layers via Open-Meteo.
 * Regular AU grid → georeferenced PNG for Leaflet ImageOverlay.
 */

import { PNG } from "pngjs";

export const ECMWF_MAP_BOUNDS: [[number, number], [number, number]] = [
  [-44.0, 112.5],
  [-9.5, 154.5],
];

const AU = {
  minLat: ECMWF_MAP_BOUNDS[0][0],
  maxLat: ECMWF_MAP_BOUNDS[1][0],
  minLon: ECMWF_MAP_BOUNDS[0][1],
  maxLon: ECMWF_MAP_BOUNDS[1][1],
};

const GRID_STEP = 2;
const COARSE_STEP = 3;
const BATCH = 45;
const BATCH_CONCURRENCY = 3;
const FORECAST_DAYS = 3;
const CACHE_TTL_MS = 12 * 60_000;
const OUT_WIDTH = 900;
const OPEN_METEO_MODEL = "ecmwf_ifs";

export type EcmwfProductGroup =
  | "surface"
  | "precip"
  | "cloud"
  | "wind"
  | "thermo"
  | "levels";

export type EcmwfPaletteId =
  | "temp"
  | "dew"
  | "rh"
  | "precip"
  | "snow"
  | "cloud"
  | "mslp"
  | "wind"
  | "cape"
  | "cin"
  | "height"
  | "weather";

export type EcmwfProduct = {
  id: string;
  label: string;
  shortLabel: string;
  group: EcmwfProductGroup;
  /** Open-Meteo hourly field name */
  field: string;
  units: string;
  palette: EcmwfPaletteId;
  /** Fixed scale; otherwise auto from frame */
  min?: number;
  max?: number;
  /** Use coarser grid (pressure-level winds) */
  coarse?: boolean;
};

const LEVELS = [1000, 925, 850, 700, 500, 300, 250, 200] as const;

function levelProducts(): EcmwfProduct[] {
  const out: EcmwfProduct[] = [];
  for (const p of LEVELS) {
    out.push(
      {
        id: `temp_${p}`,
        label: `Temperature ${p} hPa`,
        shortLabel: `T ${p}`,
        group: "levels",
        field: `temperature_${p}hPa`,
        units: "°C",
        palette: "temp",
        min: -60,
        max: 40,
      },
      {
        id: `rh_${p}`,
        label: `Relative humidity ${p} hPa`,
        shortLabel: `RH ${p}`,
        group: "levels",
        field: `relative_humidity_${p}hPa`,
        units: "%",
        palette: "rh",
        min: 0,
        max: 100,
      },
      {
        id: `gh_${p}`,
        label: `Geopotential height ${p} hPa`,
        shortLabel: `Z ${p}`,
        group: "levels",
        field: `geopotential_height_${p}hPa`,
        units: "m",
        palette: "height",
      },
      {
        id: `wind_${p}`,
        label: `Wind speed ${p} hPa`,
        shortLabel: `Wind ${p}`,
        group: "levels",
        field: `wind_speed_${p}hPa`,
        units: "km/h",
        palette: "wind",
        min: 0,
        max: 220,
        coarse: true,
      },
    );
  }
  return out;
}

export const ECMWF_PRODUCTS: EcmwfProduct[] = [
  {
    id: "temperature_2m",
    label: "Temperature 2 m",
    shortLabel: "Temp",
    group: "surface",
    field: "temperature_2m",
    units: "°C",
    palette: "temp",
    min: -10,
    max: 48,
  },
  {
    id: "dew_point_2m",
    label: "Dew point 2 m",
    shortLabel: "Dew",
    group: "surface",
    field: "dew_point_2m",
    units: "°C",
    palette: "dew",
    min: -15,
    max: 28,
  },
  {
    id: "relative_humidity_2m",
    label: "Relative humidity 2 m",
    shortLabel: "RH",
    group: "surface",
    field: "relative_humidity_2m",
    units: "%",
    palette: "rh",
    min: 0,
    max: 100,
  },
  {
    id: "pressure_msl",
    label: "Mean sea level pressure",
    shortLabel: "MSLP",
    group: "surface",
    field: "pressure_msl",
    units: "hPa",
    palette: "mslp",
    min: 980,
    max: 1040,
  },
  {
    id: "weather_code",
    label: "Weather code",
    shortLabel: "WX",
    group: "surface",
    field: "weather_code",
    units: "",
    palette: "weather",
    min: 0,
    max: 99,
  },
  {
    id: "precipitation",
    label: "Precipitation",
    shortLabel: "Rain",
    group: "precip",
    field: "precipitation",
    units: "mm",
    palette: "precip",
    min: 0,
    max: 15,
  },
  {
    id: "rain",
    label: "Rain",
    shortLabel: "Rain only",
    group: "precip",
    field: "rain",
    units: "mm",
    palette: "precip",
    min: 0,
    max: 15,
  },
  {
    id: "snowfall",
    label: "Snowfall",
    shortLabel: "Snow",
    group: "precip",
    field: "snowfall",
    units: "cm",
    palette: "snow",
    min: 0,
    max: 5,
  },
  {
    id: "cloud_cover",
    label: "Total cloud cover",
    shortLabel: "Cloud",
    group: "cloud",
    field: "cloud_cover",
    units: "%",
    palette: "cloud",
    min: 0,
    max: 100,
  },
  {
    id: "cloud_cover_low",
    label: "Low cloud",
    shortLabel: "Low cloud",
    group: "cloud",
    field: "cloud_cover_low",
    units: "%",
    palette: "cloud",
    min: 0,
    max: 100,
  },
  {
    id: "cloud_cover_mid",
    label: "Mid cloud",
    shortLabel: "Mid cloud",
    group: "cloud",
    field: "cloud_cover_mid",
    units: "%",
    palette: "cloud",
    min: 0,
    max: 100,
  },
  {
    id: "cloud_cover_high",
    label: "High cloud",
    shortLabel: "High cloud",
    group: "cloud",
    field: "cloud_cover_high",
    units: "%",
    palette: "cloud",
    min: 0,
    max: 100,
  },
  {
    id: "wind_speed_10m",
    label: "Wind speed 10 m",
    shortLabel: "Wind",
    group: "wind",
    field: "wind_speed_10m",
    units: "km/h",
    palette: "wind",
    min: 0,
    max: 90,
  },
  {
    id: "wind_gusts_10m",
    label: "Wind gusts 10 m",
    shortLabel: "Gusts",
    group: "wind",
    field: "wind_gusts_10m",
    units: "km/h",
    palette: "wind",
    min: 0,
    max: 120,
  },
  {
    id: "cape",
    label: "CAPE",
    shortLabel: "CAPE",
    group: "thermo",
    field: "cape",
    units: "J/kg",
    palette: "cape",
    min: 0,
    max: 3000,
  },
  {
    id: "cin",
    label: "CIN",
    shortLabel: "CIN",
    group: "thermo",
    field: "convective_inhibition",
    units: "J/kg",
    palette: "cin",
    min: -400,
    max: 0,
  },
  ...levelProducts(),
];

export const DEFAULT_ECMWF_PRODUCT_ID = "temperature_2m";

export const ECMWF_GROUP_LABELS: Record<EcmwfProductGroup, string> = {
  surface: "Surface",
  precip: "Precipitation",
  cloud: "Cloud",
  wind: "Wind",
  thermo: "Thermo",
  levels: "Pressure levels",
};

const PRODUCT_BY_ID = new Map(ECMWF_PRODUCTS.map((p) => [p.id, p]));

export function getEcmwfProduct(id: string | null | undefined): EcmwfProduct {
  if (id && PRODUCT_BY_ID.has(id)) return PRODUCT_BY_ID.get(id)!;
  return PRODUCT_BY_ID.get(DEFAULT_ECMWF_PRODUCT_ID)!;
}

type GridPoint = { lat: number; lon: number; values: (number | null)[] };

type ProductCache = {
  fetchedAt: number;
  times: string[];
  points: GridPoint[];
  productId: string;
};

const cache = new Map<string, ProductCache>();
const inflight = new Map<string, Promise<ProductCache>>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function buildGrid(step: number): { lat: number; lon: number }[] {
  const sites: { lat: number; lon: number }[] = [];
  for (
    let lat = AU.minLat;
    lat <= AU.maxLat + 1e-9;
    lat = Number((lat + step).toFixed(4))
  ) {
    for (
      let lon = AU.minLon;
      lon <= AU.maxLon + 1e-9;
      lon = Number((lon + step).toFixed(4))
    ) {
      sites.push({ lat, lon });
    }
  }
  return sites;
}

async function fetchBatch(
  lats: number[],
  lons: number[],
  field: string,
): Promise<
  { latitude: number; longitude: number; hourly: Record<string, unknown[]> }[]
> {
  const params = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    hourly: field,
    models: OPEN_METEO_MODEL,
    forecast_days: String(FORECAST_DAYS),
    timezone: "Australia/Sydney",
    cell_selection: "nearest",
    wind_speed_unit: "kmh",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(Math.min(4000, 600 * 2 ** attempt));
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(22_000),
      });
      if (res.status === 429) {
        lastErr = new Error("Open-Meteo 429");
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(
          Number.isFinite(retryAfter) ? retryAfter * 1000 : 2500 * (attempt + 1),
        );
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`Open-Meteo ${res.status}`);
        continue;
      }
      const json = (await res.json()) as
        | {
            latitude?: number;
            longitude?: number;
            hourly?: Record<string, unknown[]>;
          }
        | Array<{
            latitude?: number;
            longitude?: number;
            hourly?: Record<string, unknown[]>;
          }>;
      const rows = Array.isArray(json) ? json : [json];
      return rows.map((r, i) => ({
        latitude: num(r.latitude) ?? lats[i]!,
        longitude: num(r.longitude) ?? lons[i]!,
        hourly: (r.hourly ?? {}) as Record<string, unknown[]>,
      }));
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("Open-Meteo failed");
}

async function loadProductGrid(product: EcmwfProduct): Promise<ProductCache> {
  const step = product.coarse ? COARSE_STEP : GRID_STEP;
  const sites = buildGrid(step);
  const batches: { lats: number[]; lons: number[] }[] = [];
  for (let i = 0; i < sites.length; i += BATCH) {
    const slice = sites.slice(i, i + BATCH);
    batches.push({
      lats: slice.map((s) => s.lat),
      lons: slice.map((s) => s.lon),
    });
  }

  const points: GridPoint[] = [];
  let times: string[] = [];

  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    const wave = batches.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(
      wave.map((b) => fetchBatch(b.lats, b.lons, product.field)),
    );
    for (let bi = 0; bi < results.length; bi++) {
      const locs = results[bi]!;
      const b = wave[bi]!;
      for (let j = 0; j < b.lats.length; j++) {
        const loc = locs[j];
        const hourly = loc?.hourly ?? {};
        const series = (hourly[product.field] ?? []) as unknown[];
        const t = (hourly.time ?? []) as unknown[];
        if (!times.length && t.length) {
          times = t.map(String);
        }
        const values: (number | null)[] = times.map((_, ti) => num(series[ti]));
        points.push({
          lat: b.lats[j]!,
          lon: b.lons[j]!,
          values,
        });
      }
    }
    if (i + BATCH_CONCURRENCY < batches.length) await sleep(120);
  }

  if (!times.length) {
    throw new Error("ECMWF returned no hourly times");
  }

  return {
    fetchedAt: Date.now(),
    times,
    points,
    productId: product.id,
  };
}

export async function getEcmwfProductCache(
  productId: string,
  opts?: { force?: boolean },
): Promise<ProductCache> {
  const product = getEcmwfProduct(productId);
  const key = product.id;
  const hit = cache.get(key);
  if (
    !opts?.force &&
    hit &&
    Date.now() - hit.fetchedAt < CACHE_TTL_MS &&
    hit.times.length
  ) {
    return hit;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = loadProductGrid(product)
    .then((data) => {
      cache.set(key, data);
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, job);
  return job;
}

export type EcmwfMapCatalog = {
  model: string;
  modelLabel: string;
  attribution: string;
  bounds: [[number, number], [number, number]];
  defaultProductId: string;
  products: {
    id: string;
    label: string;
    shortLabel: string;
    group: EcmwfProductGroup;
    groupLabel: string;
    units: string;
  }[];
  groups: { id: EcmwfProductGroup; label: string }[];
  times: string[];
  issuedAt: string | null;
};

async function fetchHourlyTimes(field: string): Promise<string[]> {
  const params = new URLSearchParams({
    latitude: "-25.0",
    longitude: "134.0",
    hourly: field,
    models: OPEN_METEO_MODEL,
    forecast_days: String(FORECAST_DAYS),
    timezone: "Australia/Sydney",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = (await res.json()) as { hourly?: { time?: string[] } };
  return (json.hourly?.time ?? []).map(String);
}

export async function getEcmwfMapCatalog(
  productId?: string | null,
): Promise<EcmwfMapCatalog> {
  const product = getEcmwfProduct(productId);
  let times: string[] = [];
  let issuedAt: string | null = null;

  const cached = cache.get(product.id);
  if (cached?.times.length) {
    times = cached.times;
    issuedAt = new Date(cached.fetchedAt).toISOString();
  } else {
    try {
      times = await fetchHourlyTimes(product.field);
      issuedAt = new Date().toISOString();
    } catch {
      // UI can still show the picker; frame endpoint fills times later.
    }
  }

  const groups = (
    Object.keys(ECMWF_GROUP_LABELS) as EcmwfProductGroup[]
  ).map((id) => ({ id, label: ECMWF_GROUP_LABELS[id] }));

  return {
    model: OPEN_METEO_MODEL,
    modelLabel: "ECMWF IFS",
    attribution: "ECMWF IFS via Open-Meteo",
    bounds: ECMWF_MAP_BOUNDS,
    defaultProductId: DEFAULT_ECMWF_PRODUCT_ID,
    products: ECMWF_PRODUCTS.map((p) => ({
      id: p.id,
      label: p.label,
      shortLabel: p.shortLabel,
      group: p.group,
      groupLabel: ECMWF_GROUP_LABELS[p.group],
      units: p.units,
    })),
    groups,
    times,
    issuedAt,
  };
}

type RGBA = [number, number, number, number];

function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  const u = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
    Math.round(a[3] + (b[3] - a[3]) * u),
  ];
}

function stopsColor(stops: { t: number; c: RGBA }[], t: number): RGBA {
  if (t <= stops[0]!.t) return stops[0]!.c;
  if (t >= stops[stops.length - 1]!.t) return stops[stops.length - 1]!.c;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t || 1);
      return lerpColor(a.c, b.c, u);
    }
  }
  return stops[stops.length - 1]!.c;
}

function colorFor(
  palette: EcmwfPaletteId,
  t: number,
  value: number,
): RGBA {
  switch (palette) {
    case "temp":
      return stopsColor(
        [
          { t: 0, c: [30, 60, 160, 175] },
          { t: 0.25, c: [70, 170, 220, 185] },
          { t: 0.45, c: [120, 210, 120, 190] },
          { t: 0.6, c: [240, 220, 80, 195] },
          { t: 0.78, c: [240, 140, 40, 200] },
          { t: 1, c: [200, 40, 40, 210] },
        ],
        t,
      );
    case "dew":
      return stopsColor(
        [
          { t: 0, c: [90, 70, 40, 160] },
          { t: 0.35, c: [160, 180, 80, 175] },
          { t: 0.6, c: [60, 180, 140, 190] },
          { t: 1, c: [30, 100, 200, 205] },
        ],
        t,
      );
    case "rh":
      return stopsColor(
        [
          { t: 0, c: [120, 80, 40, 120] },
          { t: 0.4, c: [180, 200, 90, 160] },
          { t: 0.7, c: [70, 170, 200, 185] },
          { t: 1, c: [40, 90, 200, 205] },
        ],
        t,
      );
    case "precip": {
      if (value <= 0.05) return [0, 0, 0, 0];
      return stopsColor(
        [
          { t: 0, c: [140, 220, 255, 90] },
          { t: 0.25, c: [50, 140, 240, 160] },
          { t: 0.55, c: [40, 60, 200, 190] },
          { t: 0.8, c: [180, 40, 200, 210] },
          { t: 1, c: [220, 30, 60, 220] },
        ],
        t,
      );
    }
    case "snow": {
      if (value <= 0.02) return [0, 0, 0, 0];
      return stopsColor(
        [
          { t: 0, c: [200, 220, 255, 100] },
          { t: 0.5, c: [160, 190, 255, 170] },
          { t: 1, c: [240, 250, 255, 220] },
        ],
        t,
      );
    }
    case "cloud":
      return stopsColor(
        [
          { t: 0, c: [0, 0, 0, 0] },
          { t: 0.2, c: [180, 190, 200, 70] },
          { t: 0.55, c: [160, 170, 180, 140] },
          { t: 1, c: [230, 235, 240, 200] },
        ],
        t,
      );
    case "mslp":
      return stopsColor(
        [
          { t: 0, c: [40, 80, 200, 180] },
          { t: 0.5, c: [240, 240, 240, 40] },
          { t: 1, c: [200, 60, 60, 180] },
        ],
        t,
      );
    case "wind":
      return stopsColor(
        [
          { t: 0, c: [40, 120, 180, 80] },
          { t: 0.3, c: [60, 200, 160, 150] },
          { t: 0.55, c: [240, 220, 70, 180] },
          { t: 0.8, c: [240, 120, 40, 200] },
          { t: 1, c: [180, 30, 60, 220] },
        ],
        t,
      );
    case "cape": {
      if (value < 50) return [0, 0, 0, 0];
      return stopsColor(
        [
          { t: 0, c: [80, 180, 80, 90] },
          { t: 0.35, c: [240, 220, 60, 160] },
          { t: 0.65, c: [240, 120, 40, 190] },
          { t: 1, c: [180, 30, 80, 220] },
        ],
        t,
      );
    }
    case "cin":
      return stopsColor(
        [
          { t: 0, c: [120, 40, 160, 200] },
          { t: 0.5, c: [80, 100, 180, 140] },
          { t: 1, c: [0, 0, 0, 0] },
        ],
        t,
      );
    case "height":
      return stopsColor(
        [
          { t: 0, c: [40, 80, 180, 170] },
          { t: 0.5, c: [120, 200, 140, 160] },
          { t: 1, c: [220, 80, 60, 180] },
        ],
        t,
      );
    case "weather":
      return stopsColor(
        [
          { t: 0, c: [200, 210, 220, 40] },
          { t: 0.3, c: [100, 180, 240, 140] },
          { t: 0.6, c: [80, 100, 200, 180] },
          { t: 1, c: [180, 40, 180, 210] },
        ],
        t,
      );
    default:
      return [100, 160, 200, 160];
  }
}

function nearestTimeIndex(times: string[], preferIso?: string | null): number {
  if (!times.length) return 0;
  if (!preferIso) {
    const now = Date.now();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = Date.parse(times[i]!);
      if (!Number.isFinite(t)) continue;
      const d = Math.abs(t - now);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  }
  const target = Date.parse(preferIso);
  if (!Number.isFinite(target)) return nearestTimeIndex(times, null);
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]!);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

type ScalarGrid = {
  lats: number[];
  lons: number[];
  /** row-major [latIndex * nLon + lonIndex] */
  values: (number | null)[];
};

function buildScalarGrid(
  points: GridPoint[],
  timeIndex: number,
): ScalarGrid {
  const latSet = new Set<number>();
  const lonSet = new Set<number>();
  for (const p of points) {
    latSet.add(p.lat);
    lonSet.add(p.lon);
  }
  const lats = [...latSet].sort((a, b) => a - b);
  const lons = [...lonSet].sort((a, b) => a - b);
  const latIndex = new Map(lats.map((v, i) => [v, i]));
  const lonIndex = new Map(lons.map((v, i) => [v, i]));
  const values: (number | null)[] = new Array(lats.length * lons.length).fill(
    null,
  );
  for (const p of points) {
    const i = latIndex.get(p.lat);
    const j = lonIndex.get(p.lon);
    if (i == null || j == null) continue;
    values[i * lons.length + j] = p.values[timeIndex] ?? null;
  }
  return { lats, lons, values };
}

function bilinearSample(
  grid: ScalarGrid,
  lat: number,
  lon: number,
): number | null {
  const { lats, lons, values } = grid;
  if (!lats.length || !lons.length) return null;
  if (lat < lats[0]! || lat > lats[lats.length - 1]!) return null;
  if (lon < lons[0]! || lon > lons[lons.length - 1]!) return null;

  let i1 = 0;
  while (i1 < lats.length - 1 && lats[i1 + 1]! < lat) i1++;
  let j1 = 0;
  while (j1 < lons.length - 1 && lons[j1 + 1]! < lon) j1++;
  const i2 = Math.min(i1 + 1, lats.length - 1);
  const j2 = Math.min(j1 + 1, lons.length - 1);

  const v11 = values[i1 * lons.length + j1];
  const v12 = values[i1 * lons.length + j2];
  const v21 = values[i2 * lons.length + j1];
  const v22 = values[i2 * lons.length + j2];
  const present = [v11, v12, v21, v22].filter(
    (v): v is number => v != null,
  );
  if (!present.length) return null;
  if (present.length < 4) {
    return present.reduce((a, b) => a + b, 0) / present.length;
  }

  const ty =
    i1 === i2 ? 0 : (lat - lats[i1]!) / (lats[i2]! - lats[i1]! || 1);
  const tx =
    j1 === j2 ? 0 : (lon - lons[j1]!) / (lons[j2]! - lons[j1]! || 1);
  const a = v11! * (1 - tx) + v12! * tx;
  const b = v21! * (1 - tx) + v22! * tx;
  return a * (1 - ty) + b * ty;
}

export type EcmwfFrameResult = {
  png: Buffer;
  empty: boolean;
  time: string | null;
  productId: string;
  units: string;
  min: number | null;
  max: number | null;
};

export async function renderEcmwfFrame(opts: {
  productId?: string | null;
  time?: string | null;
  force?: boolean;
}): Promise<EcmwfFrameResult> {
  const product = getEcmwfProduct(opts.productId);
  const data = await getEcmwfProductCache(product.id, { force: opts.force });
  const ti = nearestTimeIndex(data.times, opts.time);
  const time = data.times[ti] ?? null;

  const samples: number[] = [];
  for (const p of data.points) {
    const v = p.values[ti];
    if (v != null) samples.push(v);
  }
  if (!samples.length) {
    const empty = new PNG({ width: 1, height: 1 });
    empty.data[0] = 0;
    empty.data[1] = 0;
    empty.data[2] = 0;
    empty.data[3] = 0;
    return {
      png: PNG.sync.write(empty),
      empty: true,
      time,
      productId: product.id,
      units: product.units,
      min: null,
      max: null,
    };
  }

  let vmin = product.min ?? Math.min(...samples);
  let vmax = product.max ?? Math.max(...samples);
  if (product.min == null || product.max == null) {
    samples.sort((a, b) => a - b);
    const p05 = samples[Math.floor(samples.length * 0.05)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    if (product.min == null) vmin = p05;
    if (product.max == null) vmax = p95;
  }
  if (vmax <= vmin) vmax = vmin + 1;

  const width = OUT_WIDTH;
  const height = Math.max(
    200,
    Math.round(
      (width * (AU.maxLat - AU.minLat)) / (AU.maxLon - AU.minLon || 1),
    ),
  );
  const png = new PNG({ width, height });
  const grid = buildScalarGrid(data.points, ti);

  for (let y = 0; y < height; y++) {
    const lat = AU.maxLat - ((y + 0.5) / height) * (AU.maxLat - AU.minLat);
    for (let x = 0; x < width; x++) {
      const lon = AU.minLon + ((x + 0.5) / width) * (AU.maxLon - AU.minLon);
      const value = bilinearSample(grid, lat, lon);
      const o = (width * y + x) << 2;
      if (value == null) {
        png.data[o] = 0;
        png.data[o + 1] = 0;
        png.data[o + 2] = 0;
        png.data[o + 3] = 0;
        continue;
      }
      const t = (value - vmin) / (vmax - vmin);
      const [r, g, b, a] = colorFor(product.palette, t, value);
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = a;
    }
  }

  return {
    png: PNG.sync.write(png),
    empty: false,
    time,
    productId: product.id,
    units: product.units,
    min: vmin,
    max: vmax,
  };
}
