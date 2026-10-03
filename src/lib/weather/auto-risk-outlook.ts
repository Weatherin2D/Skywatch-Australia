/**
 * Automated national convective risk outlook from Open-Meteo model fields.
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

const CACHE_MS = 20 * 60_000;
/** Empty/failed outlooks must not stick for the full cache window. */
const EMPTY_CACHE_MS = 90_000;
const BATCH = 55;
const BATCH_CONCURRENCY = 3;
const FORECAST_DAYS = AUTO_RISK_DAY_COUNT;
/** Dense national fill (~0.95° / ~100 km). Towns kept as anchors. */
const GRID_STEP_DEG = 0.95;
const MIN_FILL_KM = 80;
/** Drop ocean/fill points farther than this from any known AU site. */
const NEAR_LAND_KM = 240;

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
};

type CacheEntry = {
  at: number;
  outlook: PublicForecastResponse;
  dayPoints: Record<number, AutoRiskSamplePoint[]>;
  dayPng: Record<number, Buffer>;
};

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

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
 * Dense national sample grid: all BoM towns plus a regular fill over land.
 * Target ~400–550 points for sharper automatic risk maps.
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
): Promise<HourlyLoc[]> {
  // NOTE: Do NOT request pressure-level winds (500hPa etc.) in multi-location
  // batches — Open-Meteo regularly hangs on those and every site times out,
  // which previously left production stuck on an empty outlook.
  const params = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    hourly: [
      "temperature_2m",
      "dew_point_2m",
      "relative_humidity_2m",
      "cloud_cover",
      "precipitation_probability",
      "precipitation",
      "cape",
      "convective_inhibition",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_speed_100m",
      "wind_direction_100m",
      "wind_gusts_10m",
      "pressure_msl",
    ].join(","),
    models: "best_match",
    forecast_days: String(FORECAST_DAYS),
    timezone: "Australia/Sydney",
    cell_selection: "nearest",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
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
  let peakIdx = idxs[0]!;
  let n = 0;

  for (const i of idxs) {
    const c = num(h.cape?.[i]) ?? 0;
    const ci = num(h.convective_inhibition?.[i]) ?? 0;
    const dp = num(h.dew_point_2m?.[i]);
    const t = num(h.temperature_2m?.[i]);
    const r = num(h.relative_humidity_2m?.[i]) ?? 0;
    const cl = num(h.cloud_cover?.[i]) ?? 0;
    const pp = num(h.precipitation_probability?.[i]) ?? 0;
    const pr = num(h.precipitation?.[i]) ?? 0;
    const pmsl = num(h.pressure_msl?.[i]);

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
    if (dp != null) dew = Math.max(dew, dp);
    if (t != null) temp = Math.max(temp, t);
    rh = Math.max(rh, r);
    cloud = Math.max(cloud, cl);
    precipProb = Math.max(precipProb, pp);
    precipMm += Math.max(0, pr);
    shear = Math.max(shear, sh);
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

/** Map environment metrics → categorical rank 0–8 + hatch 0/1/2. */
export function scoreEnvironment(m: DayMetrics): {
  rank: number;
  hatch: 0 | 1 | 2;
  composite: number;
} {
  const cape = Math.max(0, m.cape);
  const moisture = clamp01((m.dewpoint - 8) / 14);
  const rhBoost = clamp01((m.rh - 30) / 55);
  // Reach high ranks sooner so the odds ladder actually lights up on storm days.
  const instability = clamp01(cape / 2200);
  const cin = m.cin;
  const cinBrake =
    cin <= -180
      ? 0.3
      : cin <= -100
        ? 0.5
        : cin <= -50
          ? 0.72
          : cin <= -20
            ? 0.9
            : 1;
  const shear = clamp01(m.shearKts / 48);
  const precipLift =
    clamp01(m.precipProb / 100) * 0.55 +
    clamp01(m.cloud / 100) * 0.15 +
    clamp01(m.precipMm / 10) * 0.3;
  /** Boundary / front / dryline / convergence lift from spatial analysis. */
  const trigger = clamp01(m.liftTrigger);
  const lift = clamp01(precipLift * 0.45 + trigger * 0.55);

  const composite =
    instability * 0.32 * cinBrake +
    moisture * 0.18 +
    rhBoost * 0.07 +
    shear * 0.14 +
    lift * 0.29;

  let rank = 0;
  if (composite >= 0.7 && cape >= 1400) rank = 8;
  else if (composite >= 0.58 && cape >= 1000) rank = 7;
  else if (composite >= 0.48 && cape >= 700) rank = 6;
  else if (composite >= 0.38 && cape >= 450) rank = 5;
  else if (composite >= 0.3 && cape >= 250) rank = 4;
  else if (composite >= 0.22 && cape >= 120) rank = 3;
  else if (composite >= 0.14 && cape >= 50) rank = 2;
  else if (
    composite >= 0.08 &&
    (cape >= 20 || m.precipProb >= 35 || m.precipMm >= 2 || trigger >= 0.45)
  ) {
    rank = 1;
  }

  // Trigger-aided bumps: fronts/drylines organise convection.
  if (rank >= 1 && trigger >= 0.55 && cape >= 200) {
    rank = Math.min(8, rank + 1);
  }
  if (rank >= 2 && shear >= 0.45 && cape >= 600) {
    rank = Math.min(8, rank + 1);
  }
  if (
    rank >= 3 &&
    trigger >= 0.65 &&
    shear >= 0.5 &&
    cape >= 800 &&
    cinBrake >= 0.65
  ) {
    rank = Math.min(8, rank + 1);
  }

  let hatch: 0 | 1 | 2 = 0;
  if (
    cape >= 1600 &&
    m.shearKts >= 38 &&
    cin > -60 &&
    composite >= 0.48 &&
    rank >= 4 &&
    trigger >= 0.35
  ) {
    hatch = 2;
  } else if (
    cape >= 900 &&
    m.shearKts >= 24 &&
    cinBrake >= 0.5 &&
    composite >= 0.3 &&
    rank >= 3 &&
    (trigger >= 0.25 || shear >= 0.55)
  ) {
    hatch = 1;
  }

  return { rank, hatch, composite };
}

async function loadAllSites(): Promise<
  { lat: number; lon: number; loc: HourlyLoc }[]
> {
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

  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    const wave = batches.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(
      wave.map(async (b) => {
        try {
          return { b, locs: await fetchBatch(b.lats, b.lons) };
        } catch (err) {
          console.warn("[auto-risk] batch failed", err);
          return { b, locs: [] as HourlyLoc[] };
        }
      }),
    );
    for (const { b, locs } of results) {
      for (let j = 0; j < b.lats.length; j++) {
        const loc = locs[j];
        if (!loc?.hourly?.time?.length) continue;
        out.push({ lat: b.lats[j]!, lon: b.lons[j]!, loc });
      }
    }
    if (i + BATCH_CONCURRENCY < batches.length) await sleep(120);
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

async function computeOutlook(): Promise<CacheEntry> {
  const rows = await loadAllSites();
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
      const scored = scoreEnvironment(site.m);
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
  const outlook: PublicForecastResponse = {
    status: anyRisk ? "ok" : "empty",
    issuedAt: new Date().toISOString(),
    mapView: { center: [-25.5, 134.5], zoom: 4 },
    days: rolled,
    defaultDay: 1,
    message: anyRisk
      ? undefined
      : "No elevated thunderstorm risk in the automated model guidance.",
  };

  console.info(
    `[auto-risk] scored ${rows.length}/${SAMPLE_SITES.length} sites, days=${FORECAST_DAYS}`,
  );

  return { at: Date.now(), outlook, dayPoints, dayPng };
}

function cacheTtlMs(entry: CacheEntry): number {
  return entry.outlook.status === "ok" ? CACHE_MS : EMPTY_CACHE_MS;
}

async function ensureCache(opts: { force?: boolean } = {}): Promise<CacheEntry> {
  if (
    !opts.force &&
    cache &&
    Date.now() - cache.at < cacheTtlMs(cache)
  ) {
    return cache;
  }
  if (!opts.force && inflight) return inflight;
  inflight = computeOutlook()
    .then((entry) => {
      cache = entry;
      return entry;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function getAutoRiskOutlook(
  opts: { force?: boolean } = {},
): Promise<PublicForecastResponse> {
  const entry = await ensureCache(opts);
  return entry.outlook;
}

export async function getAutoRiskDayPng(
  day: number,
  opts: { force?: boolean } = {},
): Promise<{ png: Buffer; empty: boolean; issuedAt: string | null } | null> {
  if (!Number.isInteger(day) || day < 1 || day > FORECAST_DAYS) return null;
  const entry = await ensureCache(opts);
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

export function isAutoRiskDay(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= FORECAST_DAYS;
}

/** Catalog payload for /api/weather/risk?source=auto */
export async function getAutoRiskCatalog(opts: { force?: boolean } = {}) {
  const outlook = await getAutoRiskOutlook(opts);
  const issued = outlook.issuedAt ?? new Date().toISOString();
  return {
    status: outlook.status,
    source: "auto" as const,
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
          ? `/api/weather/risk-image?source=auto&day=${d.effectiveDay}&t=${encodeURIComponent(issued)}`
          : null,
        issuedAt: issued,
        legend: d.legend,
      };
    }),
    legend: autoRiskLegendItems(),
    blurbs: autoRiskCategoryBlurbs(),
    attribution:
      "SkyWatch automated guidance from Open-Meteo model fields (GFS/ICON/ECMWF blend via best_match). Guidance only — not an official warning.",
    message: outlook.message,
    outlook,
  };
}

export function getAutoRiskSampleSiteCount(): number {
  return SAMPLE_SITES.length;
}
