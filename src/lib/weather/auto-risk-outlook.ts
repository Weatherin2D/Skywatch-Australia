/**
 * SkyWatch model-risk outlooks from Open-Meteo fields.
 * - Pulse: multi-model best_match blend (CAPE/LI/triggers/daylight heating)
 * - Access: BoM ACCESS-G (`bom_access_global`) when the open feed is live
 * - IFS: ECMWF IFS HRES (~9 km)
 * - UKMO: UK Met Office Global (~10 km)
 * Same day horizon as MetEye (~7 Sydney-local days). Guidance only.
 */

import type {
  PublicForecastResponse,
  RolledDay,
} from "@/lib/forecast/types";
import {
  AUTO_RISK_DAY_COUNT,
  autoRiskCategoryBlurbs,
  autoRiskLegendItems,
} from "@/lib/weather/auto-risk-categories";
import { BOM_RISK_SITES, type BomRiskSite } from "@/lib/weather/bom-risk-sites";
import {
  renderAutoRiskPng,
  summarizeUsed,
  type AutoRiskSamplePoint,
} from "@/lib/weather/auto-risk-smooth";
import {
  aestPartsToUnix,
  unixToAestParts,
} from "@/lib/weather/archive-time";
import { promises as fs } from "fs";
import path from "path";
import { get as blobGet, put as blobPut } from "@vercel/blob";

const CACHE_MS = 20 * 60_000;
/** Empty/failed outlooks must not stick for the full cache window. */
const EMPTY_CACHE_MS = 90_000;
/** Open-Meteo multi-location batches — keep under Vercel 60s budget. */
const BATCH = 50;
/** Keep modest concurrency to limit Open-Meteo 429s from Vercel egress. */
const BATCH_CONCURRENCY = 3;
/** Abort remaining waves so the handler can return before the platform 504s. */
const FETCH_BUDGET_MS = 45_000;
/** Below this fraction of SAMPLE_SITES, treat the outlook as incomplete (short TTL). */
const MIN_SITE_COVERAGE = 0.4;
const FORECAST_DAYS = AUTO_RISK_DAY_COUNT;
/** National fill (~1.2° / ~130 km). Towns kept as anchors. Target ~450–550 sites. */
const GRID_STEP_DEG = 1.2;
const MIN_FILL_KM = 100;
/** Drop ocean/fill points farther than this from any known AU site. */
const NEAR_LAND_KM = 220;

type HourlyLoc = {
  latitude?: number;
  longitude?: number;
  hourly?: Record<string, unknown[]>;
};

type DayMetrics = {
  cape: number;
  cin: number;
  dewpoint: number;
  temp: number;
  rh: number;
  cloud: number;
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  precipProb: number;
  precipMm: number;
  /** Explicit rain accumulation (mm). */
  rainMm: number;
  /** Convective showers accumulation (mm) when the model provides it. */
  showersMm: number;
  /** Peak WMO weather code for the day (thunderstorm codes 95–99). */
  weatherCode: number;
  shearKts: number;
  /** Peak-hour wind components (m/s, meteorological → u/v). */
  windU: number;
  windV: number;
  pressureHpa: number;
  /** Min vapour pressure deficit (kPa) — lower = moister column. */
  vpdMin: number;
  /** Peak surface soil temperature (°C). */
  soilTemp: number;
  /** Peak near-surface soil moisture (m³/m³); 0 when unavailable. */
  soilMoisture: number;
  /** Peak boundary-layer height (m); 0 when unavailable. */
  blHeight: number;
  /** Min freezing-level height (m); 0 when unavailable. */
  freezingLevelM: number;
  /** Peak sunshine duration in an hour (s). */
  sunshineSec: number;
  /** Peak direct shortwave (W/m²). */
  directRadiation: number;
  /**
   * Spatial lift / trigger proxy 0–1 from neighbouring samples
   * (dryline, front, convergence, moisture boundary).
   */
  liftTrigger: number;
  /** Most unstable Lifted Index of the day (°C); more negative = more unstable. */
  liftedIndex: number;
  /**
   * Daylight heating / pulse potential 0–1
   * (afternoon insolation + temp rise + moist CAPE — cells without synoptic boundaries).
   */
  diurnalHeating: number;
};

export type ModelRiskKind = "pulse" | "access" | "ifs" | "ukmo";

/** Surface / near-surface fields every model risk source requests. */
const HOURLY_CORE = [
  "temperature_2m",
  "dew_point_2m",
  "relative_humidity_2m",
  "cloud_cover",
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "precipitation",
  "precipitation_probability",
  "rain",
  "showers",
  "weather_code",
  "pressure_msl",
  "cape",
  "convective_inhibition",
  "shortwave_radiation",
  "direct_radiation",
  "vapour_pressure_deficit",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "soil_temperature_0cm",
  "sunshine_duration",
] as const;

/** Extra fields when the Open-Meteo model actually populates them. */
const HOURLY_LI = ["lifted_index"] as const;
const HOURLY_SHEAR_LADDER = [
  "wind_speed_80m",
  "wind_direction_80m",
  "wind_speed_100m",
  "wind_direction_100m",
  "wind_speed_180m",
  "wind_direction_180m",
] as const;
const HOURLY_PULSE_EXTRA = [
  "soil_moisture_0_to_1cm",
  "boundary_layer_height",
  "freezing_level_height",
] as const;
const HOURLY_IFS_EXTRA = ["boundary_layer_height"] as const;

type ModelRiskConfig = {
  kind: ModelRiskKind;
  /** Open-Meteo `models=` value */
  openMeteoModels: string;
  label: string;
  attribution: string;
  emptyMessage: string;
  /** Hourly variables to request — tailored to what the model returns. */
  hourlyFields: readonly string[];
};

const MODEL_CONFIG: Record<ModelRiskKind, ModelRiskConfig> = {
  pulse: {
    kind: "pulse",
    openMeteoModels: "best_match",
    label: "Pulse",
    attribution:
      "SkyWatch Pulse · Open-Meteo multi-model blend (CAPE, LI, CIN, cloud layers, showers, shear ladder, soil/BL, VPD, weather codes, boundaries, daylight heating). Guidance only — not an official warning.",
    emptyMessage: "No elevated thunderstorm risk in SkyWatch Pulse guidance.",
    hourlyFields: [
      ...HOURLY_CORE,
      ...HOURLY_LI,
      ...HOURLY_SHEAR_LADDER,
      ...HOURLY_PULSE_EXTRA,
    ],
  },
  access: {
    kind: "access",
    openMeteoModels: "bom_access_global",
    label: "Access",
    attribution:
      "SkyWatch Access · BoM ACCESS-G via Open-Meteo (~15 km; CAPE/LI/CIN, cloud layers, soil/BL, VPD when the feed is live). Guidance only — not an official warning.",
    emptyMessage:
      "BoM ACCESS-G open data is currently unavailable (or shows no elevated risk). Access will populate when the feed resumes.",
    // ACCESS-G often omits elevated winds on the open feed — still ask for LI/BL/soil.
    hourlyFields: [
      ...HOURLY_CORE,
      ...HOURLY_LI,
      ...HOURLY_PULSE_EXTRA,
    ],
  },
  ifs: {
    kind: "ifs",
    openMeteoModels: "ecmwf_ifs",
    label: "IFS",
    attribution:
      "SkyWatch IFS · ECMWF IFS HRES via Open-Meteo (~9 km; CAPE/CIN, cloud layers, showers, 80–180 m shear, BL height, VPD, weather codes). Guidance only — not an official warning.",
    emptyMessage: "No elevated thunderstorm risk in SkyWatch IFS guidance.",
    // IFS on Open-Meteo regularly leaves LI / soil moisture / freezing level null.
    hourlyFields: [
      ...HOURLY_CORE,
      ...HOURLY_SHEAR_LADDER,
      ...HOURLY_IFS_EXTRA,
    ],
  },
  ukmo: {
    kind: "ukmo",
    openMeteoModels: "ukmo_global_deterministic_10km",
    label: "UKMO",
    attribution:
      "SkyWatch UKMO · UK Met Office Global via Open-Meteo (~10 km; CAPE/CIN, cloud layers, rain, gust shear, soil temp, VPD, weather codes — no elevated winds/LI on the open feed). Guidance only — not an official warning.",
    emptyMessage: "No elevated thunderstorm risk in SkyWatch UKMO guidance.",
    hourlyFields: [...HOURLY_CORE],
  },
};

type CacheEntry = {
  at: number;
  outlook: PublicForecastResponse;
  dayPoints: Record<number, AutoRiskSamplePoint[]>;
  dayPng: Record<number, Buffer>;
};

const caches: Record<ModelRiskKind, CacheEntry | null> = {
  pulse: null,
  access: null,
  ifs: null,
  ukmo: null,
};
const inflightByKind: Record<ModelRiskKind, Promise<CacheEntry> | null> = {
  pulse: null,
  access: null,
  ifs: null,
  ukmo: null,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function approxKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat1 - lat2) * 111.0;
  const dLon =
    (lon1 - lon2) * 111.0 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * National sample grid: all BoM towns plus a regular fill over land.
 * Kept near ~450–550 points so cold Open-Meteo fetches stay under Vercel’s 60s limit.
 */
function buildSampleSites(): BomRiskSite[] {
  const sites: BomRiskSite[] = BOM_RISK_SITES.map((s) => ({ ...s }));

  for (
    let lat = -43.6;
    lat <= -10.4 + 1e-9;
    lat = Number((lat + GRID_STEP_DEG).toFixed(4))
  ) {
    for (
      let lon = 113.0;
      lon <= 153.6 + 1e-9;
      lon = Number((lon + GRID_STEP_DEG).toFixed(4))
    ) {
      // Skip far-offshore cells (no town within NEAR_LAND_KM).
      if (
        !BOM_RISK_SITES.some(
          (s) => approxKm(lat, lon, s.lat, s.lon) <= NEAR_LAND_KM,
        )
      ) {
        continue;
      }
      if (
        sites.some((s) => approxKm(lat, lon, s.lat, s.lon) < MIN_FILL_KM)
      ) {
        continue;
      }
      sites.push({
        name: `grid_${lat}_${lon}`,
        state: "",
        geohash: "",
        lat,
        lon,
      });
    }
  }
  return sites;
}

const SAMPLE_SITES = buildSampleSites();

function sydneyDayKey(ms: number): string {
  const p = unixToAestParts(Math.floor(ms / 1000));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function startOfSydneyDayMs(now = Date.now()): number {
  const p = unixToAestParts(Math.floor(now / 1000));
  return (
    aestPartsToUnix({
      year: p.year,
      month: p.month,
      day: p.day,
      hour: 0,
      minute: 0,
    }) * 1000
  );
}

function vectorDiffKts(
  spdA: number,
  dirA: number,
  spdB: number,
  dirB: number,
): number {
  const toUV = (spdKmh: number, dirDeg: number) => {
    const rad = (dirDeg * Math.PI) / 180;
    const spdMs = spdKmh / 3.6;
    return {
      u: -spdMs * Math.sin(rad),
      v: -spdMs * Math.cos(rad),
    };
  };
  const a = toUV(spdA, dirA);
  const b = toUV(spdB, dirB);
  return Math.hypot(a.u - b.u, a.v - b.v) * 1.94384;
}

async function fetchBatch(
  lats: number[],
  lons: number[],
  config: ModelRiskConfig,
): Promise<HourlyLoc[]> {
  // NOTE: Do NOT request pressure-level winds (500hPa etc.) in multi-location
  // batches — Open-Meteo regularly hangs on those and every site times out,
  // which previously left production stuck on an empty outlook.
  // Hourly fields are per-model (see MODEL_CONFIG) so we only ask for what
  // each feed actually populates on Open-Meteo.
  const params = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    hourly: config.hourlyFields.join(","),
    models: config.openMeteoModels,
    forecast_days: String(FORECAST_DAYS),
    timezone: "Australia/Sydney",
    cell_selection: "nearest",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(Math.min(4000, 600 * 2 ** attempt));
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(18_000),
      });
      if (res.status === 429) {
        lastErr = new Error("Open-Meteo 429");
        // Honor Retry-After when present; otherwise back off harder on rate limits.
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(
          Number.isFinite(retryAfter)
            ? Math.min(8000, Math.max(500, retryAfter * 1000))
            : Math.min(5000, 1000 * 2 ** attempt),
        );
        continue;
      }
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const json = (await res.json()) as HourlyLoc | HourlyLoc[];
      return Array.isArray(json) ? json : [json];
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("Open-Meteo failed");
}

/** True when Open-Meteo returned a usable surface timeseries (not an empty ACCESS shell). */
function locHasUsableData(loc: HourlyLoc): boolean {
  const h = loc.hourly;
  if (!h?.time?.length) return false;
  const temps = h.temperature_2m ?? [];
  const capes = h.cape ?? [];
  const dews = h.dew_point_2m ?? [];
  for (let i = 0; i < h.time.length; i++) {
    if (num(temps[i]) != null || num(capes[i]) != null || num(dews[i]) != null) {
      return true;
    }
  }
  return false;
}

function dayIndexForTime(
  times: string[],
  dayOffset: number,
  day0: string,
): number[] {
  const idxs: number[] = [];
  const d0 = Date.parse(`${day0}T00:00:00`);
  if (!Number.isFinite(d0)) return idxs;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    const key = t.slice(0, 10);
    const d = Date.parse(`${key}T00:00:00`);
    if (!Number.isFinite(d)) continue;
    const offset = Math.round((d - d0) / 86_400_000);
    if (offset === dayOffset) idxs.push(i);
  }
  return idxs;
}

function windUV(spdKmh: number, dirDeg: number): { u: number; v: number } {
  const rad = (dirDeg * Math.PI) / 180;
  const spdMs = spdKmh / 3.6;
  return {
    u: -spdMs * Math.sin(rad),
    v: -spdMs * Math.cos(rad),
  };
}

function hourFromIso(t: string): number | null {
  if (t.length < 13) return null;
  const h = Number(t.slice(11, 13));
  return Number.isFinite(h) ? h : null;
}

/** Deepest available low-level shear ladder (10 m → 80/100/180 m), else gust proxy. */
function shearFromHour(
  h: Record<string, unknown[]>,
  i: number,
): number {
  const s10 = num(h.wind_speed_10m?.[i]) ?? 0;
  const d10 = num(h.wind_direction_10m?.[i]) ?? 0;
  const gust = num(h.wind_gusts_10m?.[i]) ?? 0;
  let sh = 0;
  const layers: [string, string, number][] = [
    ["wind_speed_180m", "wind_direction_180m", 1.55],
    ["wind_speed_100m", "wind_direction_100m", 2.4],
    ["wind_speed_80m", "wind_direction_80m", 2.9],
  ];
  for (const [spdKey, dirKey, scale] of layers) {
    const spd = num(h[spdKey]?.[i]);
    const dir = num(h[dirKey]?.[i]);
    if (spd != null && dir != null) {
      sh = Math.max(sh, vectorDiffKts(spd, dir, s10, d10) * scale);
    }
  }
  sh = Math.max(sh, Math.max(0, gust - s10) * 0.55);
  sh = Math.max(sh, clamp01(s10 / 45) * 18);
  return sh;
}

/** WMO codes that imply thunder / severe convection. */
function thunderWeatherBoost(code: number): number {
  if (code === 99 || code === 96) return 1; // TS + hail
  if (code === 95 || code === 97) return 0.85; // thunderstorm
  if (code === 91 || code === 92 || code === 93 || code === 94) return 0.55;
  if (code === 29 || code === 17 || code === 18 || code === 19) return 0.4;
  return 0;
}

function metricsForDay(loc: HourlyLoc, idxs: number[]): DayMetrics | null {
  const h = loc.hourly;
  if (!h?.time?.length || !idxs.length) return null;

  let cape = 0;
  let cin = 0;
  let dew = -20;
  let temp = -20;
  let rh = 0;
  let cloud = 0;
  let cloudLow = 0;
  let cloudMid = 0;
  let cloudHigh = 0;
  let precipProb = 0;
  let precipMm = 0;
  let rainMm = 0;
  let showersMm = 0;
  let weatherCode = 0;
  let shear = 0;
  let windU = 0;
  let windV = 0;
  let pressureHpa = 1013;
  let vpdMin = Number.POSITIVE_INFINITY;
  let soilTemp = -20;
  let soilMoisture = 0;
  let blHeight = 0;
  let freezingLevelM = 0;
  let sunshineSec = 0;
  let directRadiation = 0;
  /** Most unstable (minimum) LI; null until a real value arrives. */
  let liftedIndex: number | null = null;
  let morningMinT = Number.POSITIVE_INFINITY;
  let afternoonMaxT = Number.NEGATIVE_INFINITY;
  let afternoonCape = 0;
  let afternoonDew = -20;
  let maxShortwave = 0;
  let peakIdx = idxs[0]!;
  let n = 0;

  for (const i of idxs) {
    const c = num(h.cape?.[i]) ?? 0;
    const ci = num(h.convective_inhibition?.[i]) ?? 0;
    const li = num(h.lifted_index?.[i]);
    const sw = num(h.shortwave_radiation?.[i]) ?? 0;
    const dirRad = num(h.direct_radiation?.[i]) ?? 0;
    const dp = num(h.dew_point_2m?.[i]);
    const t = num(h.temperature_2m?.[i]);
    const r = num(h.relative_humidity_2m?.[i]) ?? 0;
    const cl = num(h.cloud_cover?.[i]) ?? 0;
    const clLow = num(h.cloud_cover_low?.[i]) ?? 0;
    const clMid = num(h.cloud_cover_mid?.[i]) ?? 0;
    const clHigh = num(h.cloud_cover_high?.[i]) ?? 0;
    const pp = num(h.precipitation_probability?.[i]) ?? 0;
    const pr = num(h.precipitation?.[i]) ?? 0;
    const rain = num(h.rain?.[i]) ?? 0;
    const showers = num(h.showers?.[i]) ?? 0;
    const wcode = num(h.weather_code?.[i]) ?? 0;
    const pmsl = num(h.pressure_msl?.[i]);
    const vpd = num(h.vapour_pressure_deficit?.[i]);
    const soilT = num(h.soil_temperature_0cm?.[i]);
    const soilM = num(h.soil_moisture_0_to_1cm?.[i]);
    const blh = num(h.boundary_layer_height?.[i]);
    const fz = num(h.freezing_level_height?.[i]);
    const sun = num(h.sunshine_duration?.[i]) ?? 0;
    const hour = hourFromIso(String(h.time[i] ?? ""));

    const s10 = num(h.wind_speed_10m?.[i]) ?? 0;
    const d10 = num(h.wind_direction_10m?.[i]) ?? 0;
    const sh = shearFromHour(h, i);

    if (c >= cape) {
      cape = c;
      peakIdx = i;
      const uv = windUV(s10, d10);
      windU = uv.u;
      windV = uv.v;
      if (pmsl != null) pressureHpa = pmsl;
      if (dp != null) dew = dp;
      if (t != null) temp = t;
    }
    // CIN: keep the most inhibiting (most negative) value; some models
    // publish positive CIN — treat those as uncapped (0).
    const cinVal = ci > 0 ? 0 : ci;
    cin = Math.min(cin, cinVal);
    if (li != null) {
      liftedIndex = liftedIndex == null ? li : Math.min(liftedIndex, li);
    }
    if (dp != null) dew = Math.max(dew, dp);
    if (t != null) temp = Math.max(temp, t);
    rh = Math.max(rh, r);
    cloud = Math.max(cloud, cl);
    cloudLow = Math.max(cloudLow, clLow);
    cloudMid = Math.max(cloudMid, clMid);
    cloudHigh = Math.max(cloudHigh, clHigh);
    precipProb = Math.max(precipProb, pp);
    precipMm += Math.max(0, pr);
    rainMm += Math.max(0, rain);
    showersMm += Math.max(0, showers);
    if (thunderWeatherBoost(wcode) >= thunderWeatherBoost(weatherCode)) {
      weatherCode = wcode;
    }
    shear = Math.max(shear, sh);
    maxShortwave = Math.max(maxShortwave, sw);
    directRadiation = Math.max(directRadiation, dirRad);
    sunshineSec = Math.max(sunshineSec, sun);
    if (vpd != null) vpdMin = Math.min(vpdMin, vpd);
    if (soilT != null) soilTemp = Math.max(soilTemp, soilT);
    if (soilM != null) soilMoisture = Math.max(soilMoisture, soilM);
    if (blh != null) blHeight = Math.max(blHeight, blh);
    if (fz != null) {
      freezingLevelM =
        freezingLevelM <= 0 ? fz : Math.min(freezingLevelM, fz);
    }

    if (hour != null && t != null) {
      if (hour >= 5 && hour <= 9) {
        morningMinT = Math.min(morningMinT, t);
      }
      if (hour >= 11 && hour <= 17) {
        afternoonMaxT = Math.max(afternoonMaxT, t);
        afternoonCape = Math.max(afternoonCape, c);
        if (dp != null) afternoonDew = Math.max(afternoonDew, dp);
        if (li != null) {
          liftedIndex = liftedIndex == null ? li : Math.min(liftedIndex, li);
        }
      }
    }
    n += 1;
  }
  if (!n) return null;

  // Prefer peak-CAPE hour dew/temp/wind for boundary detection.
  const peakDp = num(h.dew_point_2m?.[peakIdx]);
  const peakT = num(h.temperature_2m?.[peakIdx]);
  const peakS = num(h.wind_speed_10m?.[peakIdx]);
  const peakD = num(h.wind_direction_10m?.[peakIdx]);
  const peakP = num(h.pressure_msl?.[peakIdx]);
  if (peakDp != null) dew = peakDp;
  if (peakT != null) temp = peakT;
  if (peakS != null && peakD != null) {
    const uv = windUV(peakS, peakD);
    windU = uv.u;
    windV = uv.v;
  }
  if (peakP != null) pressureHpa = peakP;
  if (!Number.isFinite(vpdMin)) vpdMin = 2.5;

  // Daylight heating pulse: insolation + soil heat + BL growth + moist CAPE.
  const deltaT =
    Number.isFinite(morningMinT) && Number.isFinite(afternoonMaxT)
      ? afternoonMaxT - morningMinT
      : 0;
  const moistPulse = clamp01(((afternoonDew > -19 ? afternoonDew : dew) - 12) / 12);
  const soilHeat = clamp01((soilTemp - 28) / 18);
  const blGrowth = clamp01(blHeight / 2200);
  const sunFrac = clamp01(sunshineSec / 3600);
  const diurnalHeating = clamp01(
    clamp01(deltaT / 10) * 0.2 +
      clamp01(maxShortwave / 650) * 0.22 +
      clamp01(directRadiation / 550) * 0.12 +
      sunFrac * 0.08 +
      soilHeat * 0.1 +
      blGrowth * 0.08 +
      clamp01(afternoonCape / 900) * 0.12 +
      moistPulse * 0.08,
  );

  return {
    cape,
    cin,
    dewpoint: dew,
    temp,
    rh,
    cloud,
    cloudLow,
    cloudMid,
    cloudHigh,
    precipProb,
    precipMm,
    rainMm,
    showersMm,
    weatherCode,
    shearKts: shear,
    windU,
    windV,
    pressureHpa,
    vpdMin,
    soilTemp,
    soilMoisture,
    blHeight,
    freezingLevelM,
    sunshineSec,
    directRadiation,
    liftTrigger: 0,
    // Models without LI (IFS/UKMO on Open-Meteo) stay neutral — don't fake stable.
    liftedIndex: liftedIndex ?? 0,
    diurnalHeating,
  };
}

type SiteMetrics = { lat: number; lon: number; m: DayMetrics };

/**
 * Spatial lift / triggers from neighbouring samples:
 * dryline (dewpoint gradient), front (temp + wind shift),
 * convergence, and moisture/pressure boundaries.
 */
function applyLiftTriggers(sites: SiteMetrics[]): void {
  const NEIGHBOR_KM = 280;
  for (let i = 0; i < sites.length; i++) {
    const a = sites[i]!;
    let dewGrad = 0;
    let tempGrad = 0;
    let pressGrad = 0;
    let windShift = 0;
    let conv = 0;
    let n = 0;

    for (let j = 0; j < sites.length; j++) {
      if (i === j) continue;
      const b = sites[j]!;
      const dKm = approxKm(a.lat, a.lon, b.lat, b.lon);
      if (dKm < 40 || dKm > NEIGHBOR_KM) continue;
      n += 1;
      dewGrad = Math.max(dewGrad, Math.abs(a.m.dewpoint - b.m.dewpoint) / dKm);
      // VPD contrast sharpens dryline / moisture-boundary detection.
      dewGrad = Math.max(
        dewGrad,
        (Math.abs(a.m.vpdMin - b.m.vpdMin) / dKm) * 4.5,
      );
      tempGrad = Math.max(tempGrad, Math.abs(a.m.temp - b.m.temp) / dKm);
      // Soil-temp contrast adds a daytime heating boundary signal.
      tempGrad = Math.max(
        tempGrad,
        Math.abs(a.m.soilTemp - b.m.soilTemp) / dKm / 1.4,
      );
      pressGrad = Math.max(
        pressGrad,
        Math.abs(a.m.pressureHpa - b.m.pressureHpa) / dKm,
      );

      const du = a.m.windU - b.m.windU;
      const dv = a.m.windV - b.m.windV;
      windShift = Math.max(windShift, Math.hypot(du, dv));

      // Crude convergence: inflow toward a when neighbour wind points at a.
      const dLat = a.lat - b.lat;
      const dLon = a.lon - b.lon;
      const towardA = -(b.m.windU * dLon + b.m.windV * dLat);
      if (towardA > 0) conv = Math.max(conv, towardA / Math.max(1, dKm));
    }

    if (!n) {
      a.m.liftTrigger = 0;
      continue;
    }

    // Normalize typical AU mesoscale boundary strengths.
    const dryline = clamp01(dewGrad / 0.045); // ~4.5°C / 100 km
    const front = clamp01(tempGrad / 0.04) * 0.65 + clamp01(windShift / 12) * 0.35;
    const trough = clamp01(pressGrad / 0.08);
    const convergence = clamp01(conv / 0.08);
    // Moisture axis: high dew + nearby dry air (dryline-ish) scores higher.
    const moistureAxis =
      clamp01((a.m.dewpoint - 8) / 14) * clamp01(dryline * 1.2);

    a.m.liftTrigger = clamp01(
      dryline * 0.28 +
        front * 0.28 +
        trough * 0.12 +
        convergence * 0.22 +
        moistureAxis * 0.1,
    );
  }
}

/** Map Lifted Index → instability 0–1 (more negative = more unstable). */
function liInstability(li: number): number {
  if (li <= -6) return 1;
  if (li <= -4) return 0.9;
  if (li <= -2) return 0.78;
  if (li <= 0) return 0.58;
  if (li <= 2) return 0.38; // tropical-marginal LI still useful with CAPE
  if (li <= 4) return 0.2;
  if (li <= 6) return 0.1;
  return 0.04;
}

/** Strongly positive LI suppresses convective risk. */
function liBrake(li: number): number {
  if (li >= 10) return 0.15;
  if (li >= 8) return 0.3;
  if (li >= 6) return 0.5;
  if (li >= 4) return 0.7;
  return 1;
}

/**
 * Map environment metrics → categorical rank 0–8 + hatch 0/1/2.
 * Uses the full surface/near-surface Open-Meteo suite each model provides:
 * CAPE/CIN/LI, cloud layers, rain/showers, weather codes, VPD, soil/BL,
 * shear ladder, synoptic boundaries, and daylight heating.
 */
export function scoreEnvironment(
  m: DayMetrics,
  lat = -25,
): {
  rank: number;
  hatch: 0 | 1 | 2;
  composite: number;
} {
  const cape = Math.max(0, m.cape);
  const dewMoisture = clamp01((m.dewpoint - 12) / 12);
  const rhBoost = clamp01((m.rh - 45) / 45);
  // Low VPD = moist boundary layer (kPa). Typical storm days < ~1.2.
  const vpdMoisture = clamp01((2.2 - m.vpdMin) / 2.0);
  const soilMoist = clamp01(m.soilMoisture / 0.25);
  const moisture = clamp01(
    dewMoisture * 0.55 + vpdMoisture * 0.3 + rhBoost * 0.1 + soilMoist * 0.05,
  );

  const li = m.liftedIndex;
  const liInstab = liInstability(li);
  const liSupp = liBrake(li);
  // CAPE + LI together — LI catches unstable columns that CAPE alone underplays.
  const instability = clamp01(clamp01(cape / 3600) * 0.55 + liInstab * 0.45);
  const cin = m.cin;
  const cinBrake =
    cin <= -120
      ? 0.18
      : cin <= -70
        ? 0.35
        : cin <= -35
          ? 0.55
          : cin <= -15
            ? 0.75
            : 1;
  const shear = clamp01(m.shearKts / 65);

  // Convective precip prefers showers/rain over generic precipitation totals.
  const convectivePrecip = Math.max(m.showersMm, m.rainMm * 0.85, m.precipMm * 0.7);
  const thunderCode = thunderWeatherBoost(m.weatherCode);
  // Deep convective cloud: mid+high with some low base moisture.
  const deepCloud = clamp01(
    clamp01(m.cloudMid / 100) * 0.45 +
      clamp01(m.cloudHigh / 100) * 0.35 +
      clamp01(m.cloudLow / 100) * 0.2,
  );
  const precipLift =
    clamp01(m.precipProb / 100) * 0.28 +
    clamp01(m.cloud / 100) * 0.08 +
    deepCloud * 0.18 +
    clamp01(convectivePrecip / 14) * 0.28 +
    thunderCode * 0.18;

  const tropical = lat >= -23.5;
  const subtrop = lat >= -28 && lat < -23.5;
  const diurnal = clamp01(m.diurnalHeating);
  // Tropics often run LI +2…+6 with still-active afternoon CAPE — don't zero them out.
  const liSuppEff =
    tropical && cape >= 250 ? Math.max(liSupp, 0.55) : liSupp;
  // Daylight heating is a valid trigger — especially tropics/subtropics.
  const heatTrigger =
    diurnal *
    (tropical ? 1.25 : subtrop ? 1.05 : 0.75) *
    clamp01(0.5 + moisture * 0.5);
  const synopticTrigger = clamp01(m.liftTrigger);
  const trigger = clamp01(
    Math.max(synopticTrigger, heatTrigger * 0.95, thunderCode * 0.7),
  );
  const lift = clamp01(precipLift * 0.42 + trigger * 0.58);

  // Ordinary pulse cells: moist afternoon heating. Tropical LI can sit mildly +.
  const pulseLiMax = tropical ? 6.5 : subtrop ? 5 : 3.5;
  const pulse =
    diurnal >= (tropical ? 0.28 : 0.38) &&
    moisture >= (tropical ? 0.28 : 0.38) &&
    cape >= (tropical ? 120 : 220) &&
    li <= pulseLiMax &&
    cinBrake >= (tropical ? 0.35 : 0.5) &&
    liSuppEff >= (tropical ? 0.45 : 0.7);

  // Pulse storms don't need deep shear in the composite.
  const shearTerm = pulse ? shear * 0.05 + 0.1 : shear * 0.15;

  const composite =
    (instability * 0.36 * cinBrake * liSuppEff +
      moisture * 0.15 +
      rhBoost * 0.04 +
      shearTerm +
      lift * 0.3) *
    (pulse && (tropical || subtrop) ? 1.12 : 1) *
    (thunderCode >= 0.85 ? 1.08 : 1);

  // Organised severe tiers need shear or a real boundary — not lone CAPE spikes.
  const organised = shear >= 0.35 || synopticTrigger >= 0.4 || thunderCode >= 0.85;

  // Every tier is gated hard — no free climbs from bumps.
  // Higher ranks still need organised shear/synoptic signals; pulse fills 1–3.
  let rank = 0;
  if (
    composite >= 0.88 &&
    cape >= 3000 &&
    shear >= 0.6 &&
    synopticTrigger >= 0.5 &&
    moisture >= 0.45 &&
    li <= 0
  ) {
    rank = 8; // V-High
  } else if (
    composite >= 0.78 &&
    cape >= 2400 &&
    shear >= 0.5 &&
    moisture >= 0.4 &&
    li <= 1 &&
    organised
  ) {
    rank = 7; // High
  } else if (
    composite >= 0.68 &&
    cape >= 1800 &&
    moisture >= 0.35 &&
    li <= 2 &&
    organised
  ) {
    rank = 6; // Moderate
  } else if (
    composite >= 0.58 &&
    cape >= 1300 &&
    moisture >= 0.3 &&
    organised
  ) {
    rank = 5; // Severe
  } else if (composite >= 0.44 && cape >= 750 && (organised || !tropical)) {
    rank = 4; // Slight
  } else if (composite >= 0.32 && cape >= 400) {
    rank = 3; // Low
  } else if (composite >= 0.22 && cape >= 180) {
    rank = 2; // T-Storm
  } else if (
    composite >= 0.1 &&
    (cape >= 70 ||
      (m.precipProb >= 40 && moisture >= 0.2) ||
      thunderCode >= 0.4 ||
      convectivePrecip >= 3)
  ) {
    rank = 1; // Low T-Storm
  }

  // Explicit model thunder weather codes punch through weak CAPE underestimates.
  if (thunderCode >= 0.85 && rank < 3) rank = 3;
  if (thunderCode >= 0.55 && rank < 2) rank = 2;
  if (thunderCode >= 0.4 && rank < 1) rank = 1;

  // Daylight / tropical pulse path — ordinary cells without a front/dryline.
  // Kept to ranks 1–3 so tropics get area coverage, not orange specks.
  if (pulse) {
    if (
      rank < 3 &&
      (tropical || subtrop) &&
      cape >= 450 &&
      moisture >= 0.4 &&
      li <= 5 &&
      diurnal >= 0.32
    ) {
      rank = 3; // Low
    } else if (
      rank < 2 &&
      cape >= (tropical ? 160 : 280) &&
      moisture >= (tropical ? 0.3 : 0.4) &&
      (tropical || subtrop || diurnal >= 0.5)
    ) {
      rank = 2; // T-Storm
    } else if (
      rank < 1 &&
      cape >= (tropical ? 80 : 140) &&
      moisture >= (tropical ? 0.22 : 0.32)
    ) {
      rank = 1; // Low T-Storm
    }
  }

  // Pulse-only tropics/subtropics never jump above Low — stops lone Severe specks.
  if ((tropical || subtrop) && !organised && rank > 3) {
    rank = 3;
  }

  // Broad tropical floor: moist columns with any daytime heating / showers.
  if (
    tropical &&
    rank < 1 &&
    moisture >= 0.3 &&
    cape >= 90 &&
    (diurnal >= 0.2 || m.precipProb >= 30 || convectivePrecip >= 1)
  ) {
    rank = 1;
  }
  if (
    tropical &&
    rank < 2 &&
    moisture >= 0.4 &&
    cape >= 200 &&
    diurnal >= 0.25 &&
    li <= 6.5
  ) {
    rank = 2;
  }

  // Hail-friendly column: low freezing level + strong CAPE/shear.
  const hailFriendly =
    m.freezingLevelM > 0 &&
    m.freezingLevelM <= 3800 &&
    cape >= 1400 &&
    shear >= 0.35;

  let hatch: 0 | 1 | 2 = 0;
  if (
    cape >= 2600 &&
    m.shearKts >= 48 &&
    cin > -35 &&
    composite >= 0.72 &&
    rank >= 5 &&
    synopticTrigger >= 0.55 &&
    li <= -1
  ) {
    hatch = 2;
  } else if (
    (cape >= 1600 &&
      m.shearKts >= 36 &&
      cinBrake >= 0.7 &&
      composite >= 0.52 &&
      rank >= 4 &&
      trigger >= 0.45 &&
      li <= 1) ||
    (hailFriendly && rank >= 4 && thunderCode >= 0.55)
  ) {
    hatch = 1;
  }

  return { rank, hatch, composite };
}

async function loadAllSites(
  config: ModelRiskConfig,
): Promise<{ lat: number; lon: number; loc: HourlyLoc }[]> {
  const sites = SAMPLE_SITES;
  const out: { lat: number; lon: number; loc: HourlyLoc }[] = [];
  const batches: { lats: number[]; lons: number[] }[] = [];
  for (let i = 0; i < sites.length; i += BATCH) {
    const slice = sites.slice(i, i + BATCH);
    batches.push({
      lats: slice.map((s) => s.lat),
      lons: slice.map((s) => s.lon),
    });
  }

  const started = Date.now();
  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    if (Date.now() - started > FETCH_BUDGET_MS) {
      console.warn(
        `[${config.kind}-risk] fetch budget hit after ${out.length} sites (${i}/${batches.length} batches)`,
      );
      break;
    }
    const wave = batches.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(
      wave.map(async (b) => {
        try {
          return { b, locs: await fetchBatch(b.lats, b.lons, config) };
        } catch (err) {
          console.warn(`[${config.kind}-risk] batch failed`, err);
          return { b, locs: [] as HourlyLoc[] };
        }
      }),
    );
    for (const { b, locs } of results) {
      for (let j = 0; j < b.lats.length; j++) {
        const loc = locs[j];
        if (!loc?.hourly?.time?.length || !locHasUsableData(loc)) continue;
        out.push({ lat: b.lats[j]!, lon: b.lons[j]!, loc });
      }
    }
    if (i + BATCH_CONCURRENCY < batches.length) await sleep(140);
  }
  return out;
}

function buildDayLabels(
  day0Key: string,
): { key: string; label: string; dateLabel: string }[] {
  const base = Date.parse(`${day0Key}T12:00:00`);
  const days: { key: string; label: string; dateLabel: string }[] = [];
  for (let d = 0; d < FORECAST_DAYS; d++) {
    const ms = base + d * 86_400_000;
    const key = sydneyDayKey(ms);
    const dateLabel = new Date(ms).toLocaleDateString("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    days.push({
      key,
      label: d === 0 ? "Day 1 · Today" : `Day ${d + 1}`,
      dateLabel,
    });
  }
  return days;
}

async function computeOutlook(config: ModelRiskConfig): Promise<CacheEntry> {
  const rows = await loadAllSites(config);
  const now = Date.now();
  const day0Key = sydneyDayKey(startOfSydneyDayMs(now));
  const dayMeta = buildDayLabels(day0Key);

  const dayPoints: Record<number, AutoRiskSamplePoint[]> = {};
  const dayPng: Record<number, Buffer> = {};
  const rolled: RolledDay[] = [];

  for (let d = 0; d < FORECAST_DAYS; d++) {
    const points: AutoRiskSamplePoint[] = [];
    const dayKey = dayMeta[d]!.key;
    const siteMetrics: SiteMetrics[] = [];
    for (const row of rows) {
      const times = (row.loc.hourly?.time ?? []) as string[];
      const idxs = dayIndexForTime(times, d, day0Key);
      const idxs2 =
        idxs.length > 0
          ? idxs
          : times
              .map((t, i) => (t.startsWith(dayKey) ? i : -1))
              .filter((i) => i >= 0);
      const m = metricsForDay(row.loc, idxs2);
      if (!m) continue;
      siteMetrics.push({ lat: row.lat, lon: row.lon, m });
    }
    applyLiftTriggers(siteMetrics);
    for (const site of siteMetrics) {
      const scored = scoreEnvironment(site.m, site.lat);
      if (scored.rank <= 0 && scored.hatch === 0) continue;
      points.push({
        lat: site.lat,
        lon: site.lon,
        rank: scored.rank,
        hatch: scored.hatch,
      });
    }
    dayPoints[d + 1] = points;
    // PNG rendered lazily on first image request (keeps catalog under Vercel budget).
    const used = summarizeUsed(points);
    const legend = autoRiskLegendItems({
      usedRanks: used.ranks,
      usedHatches: used.hatches,
    });
    rolled.push({
      effectiveDay: d + 1,
      storedDay: d + 1,
      validDate: dayKey,
      label: dayMeta[d]!.label,
      dateLabel: dayMeta[d]!.dateLabel,
      isToday: d === 0,
      features: [],
      legend,
      source: "categorical",
    });
  }

  const anyRisk = rolled.some((r) =>
    r.legend.some((i) => i.used && i.order < 100),
  );
  const feedDown = rows.length === 0;
  const coverage = rows.length / Math.max(1, SAMPLE_SITES.length);
  const incomplete = !feedDown && coverage < MIN_SITE_COVERAGE;
  const outlook: PublicForecastResponse = {
    status: anyRisk && !incomplete ? "ok" : "empty",
    issuedAt: new Date().toISOString(),
    mapView: { center: [-25.5, 134.5], zoom: 4 },
    days: incomplete
      ? rolled.map((d) => ({
          ...d,
          legend: autoRiskLegendItems(),
        }))
      : rolled,
    defaultDay: 1,
    message:
      incomplete
        ? `SkyWatch ${config.label} guidance is still refreshing — try again in a moment.`
        : anyRisk
          ? undefined
          : feedDown
            ? config.emptyMessage
            : `No elevated thunderstorm risk in SkyWatch ${config.label} guidance.`,
  };

  console.info(
    `[${config.kind}-risk] scored ${rows.length}/${SAMPLE_SITES.length} sites (coverage=${coverage.toFixed(2)}), days=${FORECAST_DAYS}, status=${outlook.status}`,
  );

  return { at: Date.now(), outlook, dayPoints: incomplete ? {} : dayPoints, dayPng };
}

function cacheTtlMs(entry: CacheEntry): number {
  return entry.outlook.status === "ok" ? CACHE_MS : EMPTY_CACHE_MS;
}

/** Ok-only payload shared across serverless instances (catalog + risk-image). */
type SharedPayload = {
  at: number;
  outlook: PublicForecastResponse;
  dayPoints: Record<number, AutoRiskSamplePoint[]>;
};

function sharedBlobPath(kind: ModelRiskKind) {
  return `model-risk/v3/${kind}.json`;
}

function sharedLocalPath(kind: ModelRiskKind) {
  return path.join(
    process.env.TMPDIR || "/tmp",
    "skywatch-model-risk-v3",
    `${kind}.json`,
  );
}

function isFreshOkShared(parsed: SharedPayload | null): parsed is SharedPayload {
  return Boolean(
    parsed &&
      parsed.outlook?.status === "ok" &&
      parsed.dayPoints &&
      Number.isFinite(parsed.at) &&
      Date.now() - parsed.at < CACHE_MS,
  );
}

async function readSharedOk(
  kind: ModelRiskKind,
): Promise<SharedPayload | null> {
  if (
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.BLOB_STORE_ID ||
    process.env.VERCEL
  ) {
    for (const access of ["public", "private"] as const) {
      try {
        const result = await blobGet(sharedBlobPath(kind), {
          access,
          useCache: false,
        });
        if (!result?.stream) continue;
        const text = await new Response(result.stream).text();
        const parsed = JSON.parse(text) as SharedPayload;
        if (isFreshOkShared(parsed)) return parsed;
      } catch {
        // try next access mode / fall through
      }
    }
  }
  try {
    const raw = await fs.readFile(sharedLocalPath(kind), "utf8");
    const parsed = JSON.parse(raw) as SharedPayload;
    if (isFreshOkShared(parsed)) return parsed;
  } catch {
    // miss
  }
  return null;
}

async function writeSharedOk(
  kind: ModelRiskKind,
  entry: CacheEntry,
): Promise<void> {
  if (entry.outlook.status !== "ok") return;
  const payload: SharedPayload = {
    at: entry.at,
    outlook: entry.outlook,
    dayPoints: entry.dayPoints,
  };
  const body = JSON.stringify(payload);
  try {
    await fs.mkdir(path.dirname(sharedLocalPath(kind)), { recursive: true });
    await fs.writeFile(sharedLocalPath(kind), body, "utf8");
  } catch {
    // best-effort local mirror
  }
  if (
    !(
      process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_STORE_ID ||
      process.env.VERCEL
    )
  ) {
    return;
  }
  for (const access of ["public", "private"] as const) {
    try {
      await blobPut(sharedBlobPath(kind), body, {
        access,
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      return;
    } catch {
      // try next access mode
    }
  }
}

async function ensureCache(
  kind: ModelRiskKind,
  opts: { force?: boolean } = {},
): Promise<CacheEntry> {
  const config = MODEL_CONFIG[kind];
  const cached = caches[kind];
  if (
    !opts.force &&
    cached &&
    Date.now() - cached.at < cacheTtlMs(cached)
  ) {
    return cached;
  }
  if (!opts.force && inflightByKind[kind]) return inflightByKind[kind]!;
  inflightByKind[kind] = (async () => {
    if (!opts.force) {
      const shared = await readSharedOk(kind);
      if (shared) {
        const entry: CacheEntry = {
          at: shared.at,
          outlook: shared.outlook,
          dayPoints: shared.dayPoints,
          dayPng: {},
        };
        caches[kind] = entry;
        return entry;
      }
    }
    const entry = await computeOutlook(config);
    caches[kind] = entry;
    if (entry.outlook.status === "ok") {
      // Await so the catalog response is not raced by a cold risk-image instance.
      await writeSharedOk(kind, entry).catch((err) => {
        console.warn(`[${kind}-risk] shared cache write failed`, err);
      });
    }
    return entry;
  })().finally(() => {
    inflightByKind[kind] = null;
  });
  return inflightByKind[kind]!;
}

export async function getModelRiskOutlook(
  kind: ModelRiskKind,
  opts: { force?: boolean } = {},
): Promise<PublicForecastResponse> {
  const entry = await ensureCache(kind, opts);
  return entry.outlook;
}

/** @deprecated use getModelRiskOutlook("pulse") */
export async function getAutoRiskOutlook(
  opts: { force?: boolean } = {},
): Promise<PublicForecastResponse> {
  return getModelRiskOutlook("pulse", opts);
}

export async function getModelRiskDayPng(
  kind: ModelRiskKind,
  day: number,
  opts: { force?: boolean } = {},
): Promise<{ png: Buffer; empty: boolean; issuedAt: string | null } | null> {
  if (!Number.isInteger(day) || day < 1 || day > FORECAST_DAYS) return null;
  const entry = await ensureCache(kind, opts);
  const points = entry.dayPoints[day] ?? [];
  let png = entry.dayPng[day];
  if (!png) {
    png = renderAutoRiskPng(points);
    entry.dayPng[day] = png;
  }
  return {
    png,
    empty: points.every((p) => p.rank <= 0),
    issuedAt: entry.outlook.issuedAt,
  };
}

/** @deprecated use getModelRiskDayPng("pulse", day) */
export async function getAutoRiskDayPng(
  day: number,
  opts: { force?: boolean } = {},
): Promise<{ png: Buffer; empty: boolean; issuedAt: string | null } | null> {
  return getModelRiskDayPng("pulse", day, opts);
}

export function isModelRiskDay(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= FORECAST_DAYS;
}

/** @deprecated use isModelRiskDay */
export function isAutoRiskDay(n: number): boolean {
  return isModelRiskDay(n);
}

/** Catalog payload for /api/weather/risk?source=pulse|access|auto */
export async function getModelRiskCatalog(
  kind: ModelRiskKind,
  opts: { force?: boolean } = {},
) {
  const config = MODEL_CONFIG[kind];
  const outlook = await getModelRiskOutlook(kind, opts);
  const issued = outlook.issuedAt ?? new Date().toISOString();
  return {
    status: outlook.status,
    source: kind,
    updatedAt: issued,
    issuedAt: issued,
    days: outlook.days.map((d) => {
      const available = (d.legend ?? []).some(
        (item) => item.used && item.order < 100,
      );
      return {
        day: d.effectiveDay,
        label: d.label,
        dateLabel: d.dateLabel,
        available,
        imageUrl: available
          ? `/api/weather/risk-image?source=${kind}&day=${d.effectiveDay}&t=${encodeURIComponent(issued)}`
          : null,
        issuedAt: issued,
        legend: d.legend,
      };
    }),
    legend: autoRiskLegendItems(),
    blurbs: autoRiskCategoryBlurbs(),
    attribution: config.attribution,
    message: outlook.message,
    outlook,
  };
}

/** @deprecated use getModelRiskCatalog("pulse") — `auto` URL alias */
export async function getAutoRiskCatalog(opts: { force?: boolean } = {}) {
  return getModelRiskCatalog("pulse", opts);
}

export function getAutoRiskSampleSiteCount(): number {
  return SAMPLE_SITES.length;
}

export function resolveModelRiskKind(
  sourceParam: string | null | undefined,
): ModelRiskKind | null {
  const s = (sourceParam || "").trim().toLowerCase();
  if (s === "pulse" || s === "auto") return "pulse";
  if (s === "access") return "access";
  if (s === "ifs" || s === "ecmwf" || s === "ecmwf_ifs") return "ifs";
  if (s === "ukmo" || s === "uk") return "ukmo";
  return null;
}
