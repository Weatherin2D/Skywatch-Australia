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
import { unstable_cache } from "next/cache";

const CACHE_MS = 20 * 60_000;
/** Empty/failed outlooks must not stick for the full cache window. */
const EMPTY_CACHE_MS = 90_000;
/** Open-Meteo multi-location batches — keep under Vercel 60s budget. */
const BATCH = 80;
const BATCH_CONCURRENCY = 4;
/** Abort remaining waves so the handler can return before the platform 504s. */
const FETCH_BUDGET_MS = 45_000;
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
  precipProb: number;
  precipMm: number;
  shearKts: number;
  /** Peak-hour wind components (m/s, meteorological → u/v). */
  windU: number;
  windV: number;
  pressureHpa: number;
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

type ModelRiskConfig = {
  kind: ModelRiskKind;
  /** Open-Meteo `models=` value */
  openMeteoModels: string;
  label: string;
  attribution: string;
  emptyMessage: string;
  /** Some models omit 100 m winds on Open-Meteo. */
  include100mWinds: boolean;
};

const MODEL_CONFIG: Record<ModelRiskKind, ModelRiskConfig> = {
  pulse: {
    kind: "pulse",
    openMeteoModels: "best_match",
    label: "Pulse",
    attribution:
      "SkyWatch Pulse · Open-Meteo multi-model blend (CAPE, LI, CIN, shear, boundaries, daylight heating). Guidance only — not an official warning.",
    emptyMessage: "No elevated thunderstorm risk in SkyWatch Pulse guidance.",
    include100mWinds: true,
  },
  access: {
    kind: "access",
    openMeteoModels: "bom_access_global",
    label: "Access",
    attribution:
      "SkyWatch Access · BoM ACCESS-G via Open-Meteo (~15 km). Guidance only — not an official warning.",
    emptyMessage:
      "BoM ACCESS-G open data is currently unavailable (or shows no elevated risk). Access will populate when the feed resumes.",
    include100mWinds: false,
  },
  ifs: {
    kind: "ifs",
    openMeteoModels: "ecmwf_ifs",
    label: "IFS",
    attribution:
      "SkyWatch IFS · ECMWF IFS HRES via Open-Meteo (~9 km). Guidance only — not an official warning.",
    emptyMessage: "No elevated thunderstorm risk in SkyWatch IFS guidance.",
    include100mWinds: true,
  },
  ukmo: {
    kind: "ukmo",
    openMeteoModels: "ukmo_global_deterministic_10km",
    label: "UKMO",
    attribution:
      "SkyWatch UKMO · UK Met Office Global via Open-Meteo (~10 km). Guidance only — not an official warning.",
    emptyMessage: "No elevated thunderstorm risk in SkyWatch UKMO guidance.",
    include100mWinds: false,
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
  const hourly = [
    "temperature_2m",
    "dew_point_2m",
    "relative_humidity_2m",
    "cloud_cover",
    "precipitation_probability",
    "precipitation",
    "cape",
    "convective_inhibition",
    "lifted_index",
    "shortwave_radiation",
    "wind_speed_10m",
    "wind_direction_10m",
    ...(config.include100mWinds
      ? (["wind_speed_100m", "wind_direction_100m"] as const)
      : []),
    "wind_gusts_10m",
    "pressure_msl",
  ];
  const params = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    hourly: hourly.join(","),
    models: config.openMeteoModels,
    forecast_days: String(FORECAST_DAYS),
    timezone: "Australia/Sydney",
    cell_selection: "nearest",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(Math.min(2500, 400 * 2 ** attempt));
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(18_000),
      });
      if (res.status === 429) {
        lastErr = new Error("Open-Meteo 429");
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

function metricsForDay(loc: HourlyLoc, idxs: number[]): DayMetrics | null {
  const h = loc.hourly;
  if (!h?.time?.length || !idxs.length) return null;

  let cape = 0;
  let cin = 0;
  let dew = -20;
  let temp = -20;
  let rh = 0;
  let cloud = 0;
  let precipProb = 0;
  let precipMm = 0;
  let shear = 0;
  let windU = 0;
  let windV = 0;
  let pressureHpa = 1013;
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
    const dp = num(h.dew_point_2m?.[i]);
    const t = num(h.temperature_2m?.[i]);
    const r = num(h.relative_humidity_2m?.[i]) ?? 0;
    const cl = num(h.cloud_cover?.[i]) ?? 0;
    const pp = num(h.precipitation_probability?.[i]) ?? 0;
    const pr = num(h.precipitation?.[i]) ?? 0;
    const pmsl = num(h.pressure_msl?.[i]);
    const hour = hourFromIso(String(h.time[i] ?? ""));

    const s10 = num(h.wind_speed_10m?.[i]) ?? 0;
    const d10 = num(h.wind_direction_10m?.[i]) ?? 0;
    const s100 = num(h.wind_speed_100m?.[i]);
    const d100 = num(h.wind_direction_100m?.[i]);
    const gust = num(h.wind_gusts_10m?.[i]) ?? 0;

    let sh = 0;
    if (s100 != null && d100 != null) {
      sh = vectorDiffKts(s100, d100, s10, d10) * 2.4;
    }
    sh = Math.max(sh, Math.max(0, gust - s10) * 0.55);
    sh = Math.max(sh, clamp01(s10 / 45) * 18);

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
    cin = Math.min(cin, ci);
    if (li != null) {
      liftedIndex = liftedIndex == null ? li : Math.min(liftedIndex, li);
    }
    if (dp != null) dew = Math.max(dew, dp);
    if (t != null) temp = Math.max(temp, t);
    rh = Math.max(rh, r);
    cloud = Math.max(cloud, cl);
    precipProb = Math.max(precipProb, pp);
    precipMm += Math.max(0, pr);
    shear = Math.max(shear, sh);
    maxShortwave = Math.max(maxShortwave, sw);

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

  // Daylight heating pulse: insolation + diurnal temp rise + moist afternoon CAPE.
  const deltaT =
    Number.isFinite(morningMinT) && Number.isFinite(afternoonMaxT)
      ? afternoonMaxT - morningMinT
      : 0;
  const moistPulse = clamp01(((afternoonDew > -19 ? afternoonDew : dew) - 12) / 12);
  // Weight insolation + moisture so tropics still pulse with modest CAPE.
  const diurnalHeating = clamp01(
    clamp01(deltaT / 10) * 0.28 +
      clamp01(maxShortwave / 650) * 0.34 +
      clamp01(afternoonCape / 900) * 0.22 +
      moistPulse * 0.16,
  );

  return {
    cape,
    cin,
    dewpoint: dew,
    temp,
    rh,
    cloud,
    precipProb,
    precipMm,
    shearKts: shear,
    windU,
    windV,
    pressureHpa,
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
      tempGrad = Math.max(tempGrad, Math.abs(a.m.temp - b.m.temp) / dKm);
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
 * Includes synoptic boundary lift, daylight heating pulse, and Lifted Index.
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
  const moisture = clamp01((m.dewpoint - 12) / 12);
  const rhBoost = clamp01((m.rh - 45) / 45);
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
  const precipLift =
    clamp01(m.precipProb / 100) * 0.45 +
    clamp01(m.cloud / 100) * 0.15 +
    clamp01(m.precipMm / 16) * 0.4;

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
  const trigger = clamp01(Math.max(synopticTrigger, heatTrigger * 0.95));
  const lift = clamp01(precipLift * 0.4 + trigger * 0.6);

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
    (instability * 0.38 * cinBrake * liSuppEff +
      moisture * 0.16 +
      rhBoost * 0.05 +
      shearTerm +
      lift * 0.28) *
    (pulse && (tropical || subtrop) ? 1.12 : 1);

  // Organised severe tiers need shear or a real boundary — not lone CAPE spikes.
  const organised = shear >= 0.35 || synopticTrigger >= 0.4;

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
    (cape >= 70 || (m.precipProb >= 40 && moisture >= 0.2))
  ) {
    rank = 1; // Low T-Storm
  }

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
  if (tropical && rank < 1 && moisture >= 0.3 && cape >= 90 && (diurnal >= 0.2 || m.precipProb >= 30)) {
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
    cape >= 1600 &&
    m.shearKts >= 36 &&
    cinBrake >= 0.7 &&
    composite >= 0.52 &&
    rank >= 4 &&
    trigger >= 0.45 &&
    li <= 1
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
    if (i + BATCH_CONCURRENCY < batches.length) await sleep(80);
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
  const outlook: PublicForecastResponse = {
    status: anyRisk ? "ok" : "empty",
    issuedAt: new Date().toISOString(),
    mapView: { center: [-25.5, 134.5], zoom: 4 },
    days: rolled,
    defaultDay: 1,
    message: anyRisk
      ? undefined
      : feedDown
        ? config.emptyMessage
        : `No elevated thunderstorm risk in SkyWatch ${config.label} guidance.`,
  };

  console.info(
    `[${config.kind}-risk] scored ${rows.length}/${SAMPLE_SITES.length} sites, days=${FORECAST_DAYS}`,
  );

  return { at: Date.now(), outlook, dayPoints, dayPng };
}

function cacheTtlMs(entry: CacheEntry): number {
  return entry.outlook.status === "ok" ? CACHE_MS : EMPTY_CACHE_MS;
}

/** Shared across Vercel instances so catalog + risk-image see the same dayPoints. */
type SharedPayload = {
  at: number;
  outlook: PublicForecastResponse;
  dayPoints: Record<number, AutoRiskSamplePoint[]>;
};

const loadSharedModelRisk = unstable_cache(
  async (kind: ModelRiskKind): Promise<SharedPayload> => {
    const entry = await computeOutlook(MODEL_CONFIG[kind]);
    return {
      at: entry.at,
      outlook: entry.outlook,
      dayPoints: entry.dayPoints,
    };
  },
  ["model-risk-shared-v2"],
  // Short enough that ACCESS empty shells recover; long enough to stop 504 storms.
  { revalidate: 180 },
);

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
    let entry: CacheEntry;
    if (opts.force) {
      entry = await computeOutlook(config);
    } else {
      const shared = await loadSharedModelRisk(kind);
      entry = {
        at: shared.at,
        outlook: shared.outlook,
        dayPoints: shared.dayPoints,
        dayPng: {},
      };
    }
    caches[kind] = entry;
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
