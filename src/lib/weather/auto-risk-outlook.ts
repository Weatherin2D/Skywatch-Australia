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
import { BOM_RISK_SITES } from "@/lib/weather/bom-risk-sites";
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
const BATCH = 55;
const BATCH_CONCURRENCY = 3;
const FORECAST_DAYS = AUTO_RISK_DAY_COUNT;

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
      "wind_speed_850hPa",
      "wind_direction_850hPa",
      "wind_speed_500hPa",
      "wind_direction_500hPa",
    ].join(","),
    // best_match blends GFS / ICON / ECMWF where available (Open-Meteo).
    models: "best_match",
    forecast_days: String(FORECAST_DAYS),
    timezone: "Australia/Sydney",
    cell_selection: "nearest",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(350 * attempt);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(28_000),
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

    const s10 = num(h.wind_speed_10m?.[i]) ?? 0;
    const d10 = num(h.wind_direction_10m?.[i]) ?? 0;
    const s850 = num(h.wind_speed_850hPa?.[i]);
    const d850 = num(h.wind_direction_850hPa?.[i]);
    const s500 = num(h.wind_speed_500hPa?.[i]);
    const d500 = num(h.wind_direction_500hPa?.[i]);
    const s100 = num(h.wind_speed_100m?.[i]) ?? s10;
    const d100 = num(h.wind_direction_100m?.[i]) ?? d10;

    let sh = 0;
    if (s500 != null && d500 != null) {
      sh = vectorDiffKts(s500, d500, s10, d10);
    } else if (s850 != null && d850 != null) {
      sh = vectorDiffKts(s850, d850, s10, d10);
    } else {
      void d100;
      sh = Math.abs(s100 - s10) * 0.54;
    }

    cape = Math.max(cape, c);
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
  };
}

/** Map environment metrics → categorical rank 0–8 + hatch 0/1/2. */
export function scoreEnvironment(m: DayMetrics): {
  rank: number;
  hatch: 0 | 1 | 2;
  composite: number;
} {
  const cape = Math.max(0, m.cape);
  const moisture = clamp01((m.dewpoint - 6) / 16);
  const rhBoost = clamp01((m.rh - 35) / 50);
  const instability = clamp01(cape / 2800);
  const cin = m.cin;
  const cinBrake =
    cin <= -150
      ? 0.25
      : cin <= -80
        ? 0.45
        : cin <= -40
          ? 0.7
          : cin <= -15
            ? 0.88
            : 1;
  const shear = clamp01(m.shearKts / 55);
  const lift =
    clamp01(m.precipProb / 100) * 0.55 +
    clamp01(m.cloud / 100) * 0.2 +
    clamp01(m.precipMm / 12) * 0.25;

  const composite =
    instability * 0.38 * cinBrake +
    moisture * 0.22 +
    rhBoost * 0.08 +
    shear * 0.18 +
    lift * 0.14;

  let rank = 0;
  if (composite >= 0.82 && cape >= 1800) rank = 8;
  else if (composite >= 0.72 && cape >= 1400) rank = 7;
  else if (composite >= 0.62 && cape >= 1000) rank = 6;
  else if (composite >= 0.52 && cape >= 700) rank = 5;
  else if (composite >= 0.4 && cape >= 400) rank = 4;
  else if (composite >= 0.3 && cape >= 250) rank = 3;
  else if (composite >= 0.22 && cape >= 120) rank = 2;
  else if (composite >= 0.12 && cape >= 50) rank = 1;

  if (rank >= 2 && shear >= 0.55 && cape >= 800) {
    rank = Math.min(8, rank + 1);
  }

  let hatch: 0 | 1 | 2 = 0;
  if (
    cape >= 2000 &&
    m.shearKts >= 45 &&
    cin > -50 &&
    composite >= 0.55 &&
    rank >= 4
  ) {
    hatch = 2;
  } else if (
    cape >= 1100 &&
    m.shearKts >= 28 &&
    cinBrake >= 0.55 &&
    composite >= 0.36 &&
    rank >= 3
  ) {
    hatch = 1;
  }

  return { rank, hatch, composite };
}

async function loadAllSites(): Promise<
  { lat: number; lon: number; loc: HourlyLoc }[]
> {
  const sites = BOM_RISK_SITES;
  const out: { lat: number; lon: number; loc: HourlyLoc }[] = [];
  const batches: { lats: number[]; lons: number[]; start: number }[] = [];
  for (let i = 0; i < sites.length; i += BATCH) {
    const slice = sites.slice(i, i + BATCH);
    batches.push({
      lats: slice.map((s) => s.lat),
      lons: slice.map((s) => s.lon),
      start: i,
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
    if (i + BATCH_CONCURRENCY < batches.length) await sleep(200);
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
      const scored = scoreEnvironment(m);
      if (scored.rank <= 0 && scored.hatch === 0) continue;
      points.push({
        lat: row.lat,
        lon: row.lon,
        rank: scored.rank,
        hatch: scored.hatch,
      });
    }
    dayPoints[d + 1] = points;
    dayPng[d + 1] = renderAutoRiskPng(points);
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

  return { at: Date.now(), outlook, dayPoints, dayPng };
}

async function ensureCache(): Promise<CacheEntry> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  if (inflight) return inflight;
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

export async function getAutoRiskOutlook(): Promise<PublicForecastResponse> {
  const entry = await ensureCache();
  return entry.outlook;
}

export async function getAutoRiskDayPng(
  day: number,
): Promise<{ png: Buffer; empty: boolean; issuedAt: string | null } | null> {
  if (!Number.isInteger(day) || day < 1 || day > FORECAST_DAYS) return null;
  const entry = await ensureCache();
  const png = entry.dayPng[day];
  const points = entry.dayPoints[day] ?? [];
  if (!png) return null;
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
export async function getAutoRiskCatalog() {
  const outlook = await getAutoRiskOutlook();
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
    /** Full PublicForecastResponse shape for the Risk dashboard. */
    outlook,
  };
}
