/**
 * Hourly ECMWF IFS national map layers via Open-Meteo.
 * Regular AU grid → georeferenced PNG for Leaflet ImageOverlay.
 */

import { PNG } from "pngjs";

import { useHobbyBudget } from "@/lib/runtime-budget";

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

const HOBBY = useHobbyBudget();

/**
 * National sample spacing (°). Precip / convection use HIRES.
 * Self-hosted full compute densifies all models (incl. ICON/GFS); Hobby stays lighter.
 */
const GRID_STEP = HOBBY ? 1.5 : 0.75;
const HIRES_STEP = HOBBY ? 1.0 : 0.55;
const COARSE_STEP = HOBBY ? 2.2 : 1.4;
const BATCH = HOBBY ? 60 : 70;
const BATCH_CONCURRENCY = HOBBY ? 4 : 3;
const FORECAST_DAYS = 3;
const CACHE_TTL_MS = 18 * 60_000;
const OUT_WIDTH = HOBBY ? 1280 : 1920;
const PNG_CACHE_MAX = 96;
/** Cache schema bump when grid/render behaviour changes. */
const CACHE_VER = "r7";

export type MapModelId = "ecmwf" | "icon" | "gfs";

export const MAP_MODELS: {
  id: MapModelId;
  label: string;
  openMeteo: string;
}[] = [
  { id: "ecmwf", label: "ECMWF", openMeteo: "ecmwf_ifs" },
  { id: "icon", label: "ICON", openMeteo: "icon_seamless" },
  { id: "gfs", label: "GFS", openMeteo: "gfs_seamless" },
];

const DEFAULT_MAP_MODEL: MapModelId = "ecmwf";

export function resolveMapModel(id: string | null | undefined): MapModelId {
  if (id === "icon" || id === "gfs" || id === "ecmwf") return id;
  if (id === "ecmwf_ifs" || id === "ifs") return "ecmwf";
  if (id === "icon_seamless") return "icon";
  if (id === "gfs_seamless") return "gfs";
  return DEFAULT_MAP_MODEL;
}

function openMeteoModel(id: MapModelId): string {
  return MAP_MODELS.find((m) => m.id === id)?.openMeteo ?? "ecmwf_ifs";
}

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
  /** Denser national grid (precip / convection) */
  hires?: boolean;
  /** Stamp lightning bolts where WMO weather code is thunderstorm */
  thunderBolts?: boolean;
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
    hires: true,
    thunderBolts: true,
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
    hires: true,
    thunderBolts: true,
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
    hires: true,
    thunderBolts: true,
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
    hires: true,
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
    hires: true,
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

type GridPoint = {
  lat: number;
  lon: number;
  values: (number | null)[];
  /** Parallel WMO weather codes when thunderBolts products are fetched. */
  weatherCodes?: (number | null)[];
};

type ProductCache = {
  fetchedAt: number;
  times: string[];
  points: GridPoint[];
  productId: string;
};

function gridStepFor(product: EcmwfProduct, _model: MapModelId = "ecmwf"): number {
  if (product.coarse) return COARSE_STEP;
  // Same national density for ECMWF / ICON / GFS — precip & convection get HIRES.
  if (product.hires) return HIRES_STEP;
  return GRID_STEP;
}

function hourlyFieldsFor(product: EcmwfProduct): string {
  if (product.thunderBolts && product.field !== "weather_code") {
    return `${product.field},weather_code`;
  }
  return product.field;
}

/** WMO weather codes for thunderstorm (Open-Meteo / WMO 4677 subset). */
function isThunderCode(code: number | null | undefined): boolean {
  return code === 95 || code === 96 || code === 97 || code === 99;
}

export type EcmwfFrameResult = {
  png: Buffer;
  empty: boolean;
  time: string | null;
  productId: string;
  units: string;
  min: number | null;
  max: number | null;
  /** National sample spacing used for this product/model (°). */
  gridStep: number;
  /** Sample sites in the product cache. */
  gridPoints: number;
};

const cache = new Map<string, ProductCache>();
const inflight = new Map<string, Promise<ProductCache>>();
const pngCache = new Map<string, EcmwfFrameResult>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pngCacheKey(
  model: MapModelId,
  productId: string,
  time: string,
  diffModel?: MapModelId | null,
): string {
  const diff = diffModel ? `|diff:${diffModel}` : "";
  return `${CACHE_VER}|${model}|${productId}|${time}${diff}`;
}

function productCacheKey(model: MapModelId, productId: string): string {
  return `${CACHE_VER}|${model}|${productId}`;
}

function rememberPng(key: string, result: EcmwfFrameResult): void {
  pngCache.set(key, result);
  if (pngCache.size <= PNG_CACHE_MAX) return;
  const oldest = pngCache.keys().next().value;
  if (oldest) pngCache.delete(oldest);
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
  fields: string,
  model: MapModelId,
): Promise<
  { latitude: number; longitude: number; hourly: Record<string, unknown[]> }[]
> {
  const params = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    hourly: fields,
    models: openMeteoModel(model),
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
        signal: AbortSignal.timeout(16_000),
      });
      if (res.status === 429) {
        lastErr = new Error("Open-Meteo 429");
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(
          Number.isFinite(retryAfter) ? retryAfter * 1000 : 1800 * (attempt + 1),
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

async function loadProductGrid(
  product: EcmwfProduct,
  model: MapModelId,
): Promise<ProductCache> {
  const step = gridStepFor(product, model);
  const fields = hourlyFieldsFor(product);
  const sites = buildGrid(step);
  const batches: { lats: number[]; lons: number[] }[] = [];
  for (let i = 0; i < sites.length; i += BATCH) {
    const slice = sites.slice(i, i + BATCH);
    batches.push({
      lats: slice.map((s) => s.lat),
      lons: slice.map((s) => s.lon),
    });
  }

  type RawSite = {
    lat: number;
    lon: number;
    series: unknown[];
    wxSeries: unknown[];
  };
  const rawSites: RawSite[] = [];
  let times: string[] = [];

  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    const wave = batches.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(
      wave.map(async (b) => {
        try {
          return await fetchBatch(b.lats, b.lons, fields, model);
        } catch {
          return [] as Awaited<ReturnType<typeof fetchBatch>>;
        }
      }),
    );
    for (let bi = 0; bi < results.length; bi++) {
      const locs = results[bi]!;
      const b = wave[bi]!;
      for (let j = 0; j < b.lats.length; j++) {
        const loc = locs[j];
        const hourly = loc?.hourly ?? {};
        const series = (hourly[product.field] ?? []) as unknown[];
        const wxSeries = (hourly.weather_code ?? []) as unknown[];
        const t = (hourly.time ?? []) as unknown[];
        if (!times.length && t.length) {
          times = t.map(String);
        }
        rawSites.push({
          lat: b.lats[j]!,
          lon: b.lons[j]!,
          series,
          wxSeries,
        });
      }
    }
    // Brief pause between waves so denser national grids don't trip 429s.
    if (i + BATCH_CONCURRENCY < batches.length && batches.length > 4) {
      await sleep(HOBBY ? 45 : 70);
    }
  }

  if (!times.length) {
    throw new Error("ECMWF returned no hourly times");
  }

  const points: GridPoint[] = rawSites.map((site) => {
    const values: (number | null)[] = times.map((_, ti) =>
      num(site.series[ti]),
    );
    const weatherCodes = product.thunderBolts
      ? times.map((_, ti) =>
          product.field === "weather_code"
            ? num(site.series[ti])
            : num(site.wxSeries[ti]),
        )
      : undefined;
    return {
      lat: site.lat,
      lon: site.lon,
      values,
      weatherCodes,
    };
  });

  return {
    fetchedAt: Date.now(),
    times,
    points,
    productId: product.id,
  };
}

export async function getEcmwfProductCache(
  productId: string,
  opts?: { force?: boolean; model?: MapModelId | string | null },
): Promise<ProductCache> {
  const product = getEcmwfProduct(productId);
  const model = resolveMapModel(opts?.model);
  const key = productCacheKey(model, product.id);
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

  const job = loadProductGrid(product, model)
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
  defaultModelId: MapModelId;
  models: { id: MapModelId; label: string }[];
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

async function fetchHourlyTimes(
  field: string,
  model: MapModelId,
): Promise<string[]> {
  const params = new URLSearchParams({
    latitude: "-25.0",
    longitude: "134.0",
    hourly: field,
    models: openMeteoModel(model),
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
  modelId?: string | null,
): Promise<EcmwfMapCatalog> {
  const product = getEcmwfProduct(productId);
  const model = resolveMapModel(modelId);
  const modelMeta = MAP_MODELS.find((m) => m.id === model)!;
  let times: string[] = [];
  let issuedAt: string | null = null;

  const cached = cache.get(productCacheKey(model, product.id));
  if (cached?.times.length) {
    times = cached.times;
    issuedAt = new Date(cached.fetchedAt).toISOString();
  } else {
    try {
      times = await fetchHourlyTimes(product.field, model);
      issuedAt = new Date().toISOString();
    } catch {
      // UI can still show the picker; frame endpoint fills times later.
    }
  }

  const groups = (
    Object.keys(ECMWF_GROUP_LABELS) as EcmwfProductGroup[]
  ).map((id) => ({ id, label: ECMWF_GROUP_LABELS[id] }));

  return {
    model: openMeteoModel(model),
    modelLabel: modelMeta.label,
    attribution: `${modelMeta.label} via Open-Meteo`,
    bounds: ECMWF_MAP_BOUNDS,
    defaultProductId: DEFAULT_ECMWF_PRODUCT_ID,
    defaultModelId: DEFAULT_MAP_MODEL,
    models: MAP_MODELS.map((m) => ({ id: m.id, label: m.label })),
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
      if (value <= 0) return [0, 0, 0, 0];
      const [r, g, b, a] = stopsColor(
        [
          { t: 0, c: [140, 220, 255, 90] },
          { t: 0.25, c: [50, 140, 240, 160] },
          { t: 0.55, c: [40, 60, 200, 190] },
          { t: 0.8, c: [180, 40, 200, 210] },
          { t: 1, c: [220, 30, 60, 220] },
        ],
        t,
      );
      // Soften the rain edge so bilinear samples don't read as hard squares.
      if (value < 0.2) {
        return [r, g, b, Math.round(a * (value / 0.2))];
      }
      return [r, g, b, a];
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

function latLonToPx(
  lat: number,
  lon: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const x = ((lon - AU.minLon) / (AU.maxLon - AU.minLon)) * width;
  const y = ((AU.maxLat - lat) / (AU.maxLat - AU.minLat)) * height;
  return { x, y };
}

function blendPixel(
  png: PNG,
  width: number,
  height: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
  const o = (width * yi + xi) << 2;
  const srcA = a / 255;
  const dstA = (png.data[o + 3] ?? 0) / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  png.data[o] = Math.round(
    (r * srcA + (png.data[o] ?? 0) * dstA * (1 - srcA)) / outA,
  );
  png.data[o + 1] = Math.round(
    (g * srcA + (png.data[o + 1] ?? 0) * dstA * (1 - srcA)) / outA,
  );
  png.data[o + 2] = Math.round(
    (b * srcA + (png.data[o + 2] ?? 0) * dstA * (1 - srcA)) / outA,
  );
  png.data[o + 3] = Math.round(outA * 255);
}

/** Compact Windy-style zigzag bolt centred at (cx, cy). */
function drawLightningBolt(
  png: PNG,
  width: number,
  height: number,
  cx: number,
  cy: number,
  scale = 1,
): void {
  // Classic 4-segment zig-zag (tip → mid → mid → tip).
  const pts: [number, number][] = [
    [0.5, -8],
    [3.5, -1],
    [-0.5, -1],
    [4, 8],
    [0.5, 2],
    [-3.5, 8],
  ];
  const s = Math.max(0.85, scale);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = cx + (x0 + (x1 - x0) * t) * s;
      const y = cy + (y0 + (y1 - y0) * t) * s;
      // Slightly thicker core so bolts stay readable on rain fills.
      for (const [dx, dy, a] of [
        [0, 0, 245],
        [1, 0, 210],
        [0, 1, 200],
        [-1, 0, 170],
        [0, -1, 170],
      ] as const) {
        blendPixel(png, width, height, x + dx, y + dy, 255, 255, 255, a);
      }
    }
  }
}

function paintThunderBolts(
  png: PNG,
  width: number,
  height: number,
  points: GridPoint[],
  timeIndex: number,
  product: EcmwfProduct,
): void {
  const cells: { lat: number; lon: number; hail: boolean }[] = [];
  for (const p of points) {
    const code =
      p.weatherCodes?.[timeIndex] ??
      (product.field === "weather_code" ? p.values[timeIndex] : null);
    if (!isThunderCode(code)) continue;
    cells.push({
      lat: p.lat,
      lon: p.lon,
      hail: code === 96 || code === 99,
    });
  }
  if (!cells.length) return;

  // Dense lattice inside each thunder cell (Windy-like packing).
  for (const cell of cells) {
    const { x, y } = latLonToPx(cell.lat, cell.lon, width, height);
    const offsets: [number, number][] = cell.hail
      ? [
          [0, 0],
          [10, -8],
          [-9, 7],
          [8, 9],
          [-11, -6],
          [0, 12],
          [12, 2],
        ]
      : [
          [0, 0],
          [9, -7],
          [-8, 6],
          [7, 8],
          [-10, -5],
        ];
    for (const [dx, dy] of offsets) {
      drawLightningBolt(png, width, height, x + dx, y + dy, cell.hail ? 1.05 : 0.95);
    }
  }
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

function formatEcmwfValue(product: EcmwfProduct, value: number): string {
  const u = product.units;
  if (product.palette === "temp" || product.palette === "dew") {
    return `${Math.round(value * 10) / 10}${u ? ` ${u}` : "°C"}`;
  }
  if (product.palette === "precip" || product.palette === "snow") {
    return `${Math.round(value * 10) / 10}${u ? ` ${u}` : ""}`;
  }
  if (product.palette === "mslp") {
    return `${Math.round(value)}${u ? ` ${u}` : " hPa"}`;
  }
  if (product.palette === "wind") {
    return `${Math.round(value)}${u ? ` ${u}` : " km/h"}`;
  }
  if (product.palette === "cape" || product.palette === "cin") {
    return `${Math.round(value)}${u ? ` ${u}` : ""}`;
  }
  if (product.palette === "rh" || product.palette === "cloud") {
    return `${Math.round(value)}${u ? ` ${u}` : "%"}`;
  }
  if (product.palette === "height") {
    return `${Math.round(value)}${u ? ` ${u}` : " m"}`;
  }
  return `${Math.round(value * 10) / 10}${u ? ` ${u}` : ""}`;
}

export type EcmwfPointSample = {
  lat: number;
  lon: number;
  time: string | null;
  productId: string;
  label: string;
  units: string;
  value: number | null;
  formatted: string;
};

function colorForDiff(t: number): RGBA {
  // t in [-1, 1] mapped: blue (neg) → white (0) → red (pos)
  const u = Math.max(-1, Math.min(1, t));
  if (u < 0) {
    return lerpColor([40, 90, 220, 190], [245, 245, 245, 40], u + 1);
  }
  return lerpColor([245, 245, 245, 40], [220, 50, 50, 200], u);
}

async function fetchPointSeries(
  lat: number,
  lon: number,
  field: string,
  model: MapModelId,
): Promise<{ times: string[]; series: (number | null)[] }> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: field,
    models: openMeteoModel(model),
    forecast_days: String(FORECAST_DAYS),
    timezone: "Australia/Sydney",
    wind_speed_unit: "kmh",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = (await res.json()) as {
    hourly?: Record<string, unknown[]>;
  };
  const times = ((json.hourly?.time ?? []) as unknown[]).map(String);
  const series = ((json.hourly?.[field] ?? []) as unknown[]).map(num);
  return { times, series };
}

/** Exact Open-Meteo point sample for map clicks (fast, independent of grid cache). */
export async function sampleEcmwfPoint(opts: {
  productId?: string | null;
  time?: string | null;
  lat: number;
  lon: number;
  model?: string | null;
  diffModel?: string | null;
}): Promise<EcmwfPointSample> {
  const product = getEcmwfProduct(opts.productId);
  const model = resolveMapModel(opts.model);
  const diffModel = opts.diffModel ? resolveMapModel(opts.diffModel) : null;
  const useDiff = Boolean(diffModel && diffModel !== model);
  const lat = opts.lat;
  const lon = opts.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid coordinates");
  }

  // Prefer in-memory grid when warm (instant, matches the painted field).
  const warm = cache.get(productCacheKey(model, product.id));
  const warmDiff =
    useDiff && diffModel
      ? cache.get(productCacheKey(diffModel, product.id))
      : null;
  if (warm?.times.length && warm.points.length && (!useDiff || warmDiff)) {
    const ti = nearestTimeIndex(warm.times, opts.time);
    const grid = buildScalarGrid(warm.points, ti);
    let value = bilinearSample(grid, lat, lon);
    if (useDiff && warmDiff && value != null) {
      const dti = nearestTimeIndex(warmDiff.times, warm.times[ti]);
      const other = bilinearSample(
        buildScalarGrid(warmDiff.points, dti),
        lat,
        lon,
      );
      value = other == null ? null : value - other;
    }
    const units = useDiff ? `Δ ${product.units}` : product.units;
    return {
      lat,
      lon,
      time: warm.times[ti] ?? null,
      productId: product.id,
      label: useDiff
        ? `${product.label} (${model}−${diffModel})`
        : product.label,
      units,
      value,
      formatted:
        value == null
          ? "—"
          : useDiff
            ? `${value >= 0 ? "+" : ""}${Math.round(value * 10) / 10}${units ? ` ${units}` : ""}`
            : formatEcmwfValue(product, value),
    };
  }

  const primary = await fetchPointSeries(lat, lon, product.field, model);
  const ti = nearestTimeIndex(primary.times, opts.time);
  let value = primary.series[ti] ?? null;
  if (useDiff && diffModel && value != null) {
    const other = await fetchPointSeries(lat, lon, product.field, diffModel);
    const dti = nearestTimeIndex(other.times, primary.times[ti]);
    const b = other.series[dti] ?? null;
    value = b == null ? null : value - b;
  }
  const units = useDiff ? `Δ ${product.units}` : product.units;
  return {
    lat,
    lon,
    time: primary.times[ti] ?? null,
    productId: product.id,
    label: useDiff
      ? `${product.label} (${model}−${diffModel})`
      : product.label,
    units,
    value,
    formatted:
      value == null
        ? "—"
        : useDiff
          ? `${value >= 0 ? "+" : ""}${Math.round(value * 10) / 10}${units ? ` ${units}` : ""}`
          : formatEcmwfValue(product, value),
  };
}

/** Hourly series at a point for meteogram sparklines. */
export async function sampleEcmwfMeteogram(opts: {
  productId?: string | null;
  lat: number;
  lon: number;
  model?: string | null;
}): Promise<{
  lat: number;
  lon: number;
  productId: string;
  label: string;
  units: string;
  model: MapModelId;
  times: string[];
  values: (number | null)[];
}> {
  const product = getEcmwfProduct(opts.productId);
  const model = resolveMapModel(opts.model);
  const { times, series } = await fetchPointSeries(
    opts.lat,
    opts.lon,
    product.field,
    model,
  );
  return {
    lat: opts.lat,
    lon: opts.lon,
    productId: product.id,
    label: product.label,
    units: product.units,
    model,
    times,
    values: series,
  };
}

export async function renderEcmwfFrame(opts: {
  productId?: string | null;
  time?: string | null;
  force?: boolean;
  model?: string | null;
  /** When set, render model − diffModel (diverging colormap). */
  diffModel?: string | null;
  /** Internal: skip neighbour prefetch to avoid cascades. */
  skipPrefetch?: boolean;
}): Promise<EcmwfFrameResult> {
  const product = getEcmwfProduct(opts.productId);
  const model = resolveMapModel(opts.model);
  const diffModel = opts.diffModel ? resolveMapModel(opts.diffModel) : null;
  const data = await getEcmwfProductCache(product.id, {
    force: opts.force,
    model,
  });
  const diffData =
    diffModel && diffModel !== model
      ? await getEcmwfProductCache(product.id, {
          force: opts.force,
          model: diffModel,
        })
      : null;
  const ti = nearestTimeIndex(data.times, opts.time);
  const time = data.times[ti] ?? null;
  const cacheKey = time
    ? pngCacheKey(model, product.id, time, diffData ? diffModel : null)
    : "";

  if (!opts.force && cacheKey) {
    const hit = pngCache.get(cacheKey);
    if (hit) return hit;
  }

  const isDiff = Boolean(diffData);
  const diffTi = diffData
    ? nearestTimeIndex(diffData.times, time)
    : ti;

  const samples: number[] = [];
  if (isDiff && diffData) {
    for (let i = 0; i < data.points.length; i++) {
      const a = data.points[i]!.values[ti];
      const bPt = diffData.points[i];
      const b = bPt?.values[diffTi];
      if (a != null && b != null) samples.push(a - b);
    }
  } else {
    for (const p of data.points) {
      const v = p.values[ti];
      if (v != null) samples.push(v);
    }
  }
  if (!samples.length) {
    const empty = new PNG({ width: 1, height: 1 });
    empty.data[0] = 0;
    empty.data[1] = 0;
    empty.data[2] = 0;
    empty.data[3] = 0;
    const result: EcmwfFrameResult = {
      png: PNG.sync.write(empty),
      empty: true,
      time,
      productId: product.id,
      units: isDiff ? `Δ ${product.units}` : product.units,
      min: null,
      max: null,
      gridStep: gridStepFor(product, model),
      gridPoints: data.points.length,
    };
    if (cacheKey) rememberPng(cacheKey, result);
    return result;
  }

  let vmin: number;
  let vmax: number;
  if (isDiff) {
    const absMax = Math.max(
      ...samples.map((v) => Math.abs(v)),
      0.1,
    );
    vmin = -absMax;
    vmax = absMax;
  } else {
    vmin = product.min ?? Math.min(...samples);
    vmax = product.max ?? Math.max(...samples);
    if (product.min == null || product.max == null) {
      samples.sort((a, b) => a - b);
      const p05 = samples[Math.floor(samples.length * 0.05)]!;
      const p95 = samples[Math.floor(samples.length * 0.95)]!;
      if (product.min == null) vmin = p05;
      if (product.max == null) vmax = p95;
    }
    if (vmax <= vmin) vmax = vmin + 1;
  }

  const width = OUT_WIDTH;
  const height = Math.max(
    200,
    Math.round(
      (width * (AU.maxLat - AU.minLat)) / (AU.maxLon - AU.minLon || 1),
    ),
  );
  const png = new PNG({ width, height });
  const grid = buildScalarGrid(data.points, ti);
  const diffGrid = diffData
    ? buildScalarGrid(diffData.points, diffTi)
    : null;
  const lat0 = grid.lats[0] ?? AU.minLat;
  const lon0 = grid.lons[0] ?? AU.minLon;
  const dLat = grid.lats.length > 1 ? grid.lats[1]! - grid.lats[0]! : GRID_STEP;
  const dLon = grid.lons.length > 1 ? grid.lons[1]! - grid.lons[0]! : GRID_STEP;

  function sampleGridAt(
    g: ScalarGrid,
    lat: number,
    lon: number,
    gLat0: number,
    gLon0: number,
    gDLat: number,
    gDLon: number,
  ): number | null {
    const fi =
      gDLat === 0
        ? 0
        : Math.max(0, Math.min(g.lats.length - 1, (lat - gLat0) / gDLat));
    const fj =
      gDLon === 0
        ? 0
        : Math.max(0, Math.min(g.lons.length - 1, (lon - gLon0) / gDLon));
    const i1 = Math.floor(fi);
    const j1 = Math.floor(fj);
    const i2 = Math.min(i1 + 1, g.lats.length - 1);
    const j2 = Math.min(j1 + 1, g.lons.length - 1);
    const ty = fi - i1;
    const tx = fj - j1;
    const nLon = g.lons.length;
    const v11 = g.values[i1 * nLon + j1];
    const v12 = g.values[i1 * nLon + j2];
    const v21 = g.values[i2 * nLon + j1];
    const v22 = g.values[i2 * nLon + j2];
    if (v11 != null && v12 != null && v21 != null && v22 != null) {
      const a = v11 * (1 - tx) + v12 * tx;
      const b = v21 * (1 - tx) + v22 * tx;
      return a * (1 - ty) + b * ty;
    }
    const present = [v11, v12, v21, v22].filter(
      (v): v is number => v != null,
    );
    if (!present.length) return null;
    return present.reduce((s, v) => s + v, 0) / present.length;
  }

  const dLat0 = diffGrid?.lats[0] ?? lat0;
  const dLon0 = diffGrid?.lons[0] ?? lon0;
  const dDLat =
    diffGrid && diffGrid.lats.length > 1
      ? diffGrid.lats[1]! - diffGrid.lats[0]!
      : dLat;
  const dDLon =
    diffGrid && diffGrid.lons.length > 1
      ? diffGrid.lons[1]! - diffGrid.lons[0]!
      : dLon;

  for (let y = 0; y < height; y++) {
    const lat = AU.maxLat - ((y + 0.5) / height) * (AU.maxLat - AU.minLat);
    for (let x = 0; x < width; x++) {
      const lon = AU.minLon + ((x + 0.5) / width) * (AU.maxLon - AU.minLon);
      let value = sampleGridAt(grid, lat, lon, lat0, lon0, dLat, dLon);
      if (isDiff && diffGrid && value != null) {
        const other = sampleGridAt(
          diffGrid,
          lat,
          lon,
          dLat0,
          dLon0,
          dDLat,
          dDLon,
        );
        value = other == null ? null : value - other;
      }
      const o = (width * y + x) << 2;
      if (value == null) {
        png.data[o] = 0;
        png.data[o + 1] = 0;
        png.data[o + 2] = 0;
        png.data[o + 3] = 0;
        continue;
      }
      let r: number;
      let g: number;
      let b: number;
      let a: number;
      if (isDiff) {
        const t = value / (vmax || 1); // [-1, 1]
        [r, g, b, a] = colorForDiff(t);
      } else {
        const t = (value - vmin) / (vmax - vmin);
        [r, g, b, a] = colorFor(product.palette, t, value);
      }
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = a;
    }
  }

  if (product.thunderBolts && !isDiff) {
    paintThunderBolts(png, width, height, data.points, ti, product);
  }

  const result: EcmwfFrameResult = {
    png: PNG.sync.write(png),
    empty: false,
    time,
    productId: product.id,
    units: isDiff ? `Δ ${product.units}` : product.units,
    min: vmin,
    max: vmax,
    gridStep: gridStepFor(product, model),
    gridPoints: data.points.length,
  };
  if (cacheKey) rememberPng(cacheKey, result);

  // Prefetch neighbour hours in the background so scrubbing stays snappy.
  if (time && !opts.force && !opts.skipPrefetch) {
    const neighbors = [ti - 1, ti + 1, ti + 2].filter(
      (i) => i >= 0 && i < data.times.length && i !== ti,
    );
    const prefetchDiff = isDiff ? diffModel : null;
    void Promise.resolve().then(async () => {
      for (const ni of neighbors) {
        const nt = data.times[ni]!;
        const nk = pngCacheKey(model, product.id, nt, prefetchDiff);
        if (pngCache.has(nk)) continue;
        try {
          await renderEcmwfFrame({
            productId: product.id,
            time: nt,
            model,
            diffModel: prefetchDiff,
            skipPrefetch: true,
          });
        } catch {
          /* ignore prefetch errors */
        }
      }
    });
  }

  return result;
}
