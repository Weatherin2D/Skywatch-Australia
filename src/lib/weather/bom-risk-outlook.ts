/**
 * Live Day 1–3 convective risk outlook built from BoM public forecasts
 * (api.weather.bom.gov.au) plus active severe thunderstorm warnings.
 *
 * No admin upload — maps refresh from BoM on each cache miss.
 */

import type {
  DisplayFeature,
  DisplayLegendItem,
  GeoJsonGeometry,
  PublicForecastResponse,
} from "@/lib/forecast/types";
import {
  BOM_THUNDERSTORM_CATEGORIES,
  bomLegendItems,
  bomRiskDayLabels,
  type BomRiskCategoryId,
} from "@/lib/weather/bom-thunderstorm";
import { BOM_RISK_SITES, type BomRiskSite } from "@/lib/weather/bom-risk-sites";

const BOM_API = "https://api.weather.bom.gov.au/v1";
const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CACHE_MS = 15 * 60_000;
/** BoM rate-limits Vercel datacenter bursts — pace national sampling in waves. */
const WAVE_SIZE = 20;
const WAVE_CONCURRENCY = 10;
const WAVE_PAUSE_MS = 1100;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_RETRIES = 1;
/** Half-width of each sample cell in degrees (lon scaled by cos(lat)). */
const CELL_HALF_DEG = 1.05;

const CATEGORY_RANK: Record<BomRiskCategoryId, number> = {
  tstm_possible: 1,
  tstm_likely: 2,
  severe_possible: 3,
  severe_likely: 4,
};

const CATEGORY_LABEL: Record<BomRiskCategoryId, string> = Object.fromEntries(
  BOM_THUNDERSTORM_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<BomRiskCategoryId, string>;

const CATEGORY_ORDER: Record<BomRiskCategoryId, number> = Object.fromEntries(
  BOM_THUNDERSTORM_CATEGORIES.map((c, i) => [c.id, i]),
) as Record<BomRiskCategoryId, number>;

type DailyRow = {
  date?: string;
  icon_descriptor?: string;
  short_text?: string;
  extended_text?: string;
};

type WarningSummary = {
  id?: string;
  type?: string;
  title?: string;
  state?: string;
  states?: string[];
  phase?: string;
  issue_time?: string | null;
};

type CacheEntry = {
  at: number;
  value: PublicForecastResponse;
};

let cache: CacheEntry | null = null;
let inflight: Promise<PublicForecastResponse> | null = null;

/** Approximate centres for common BoM forecast districts (severe warning titles). */
const FORECAST_DISTRICT_CENTRES: Array<{
  match: RegExp;
  state: string;
  lat: number;
  lon: number;
  radiusKm: number;
}> = [
  { match: /\bgoldfields\b/i, state: "WA", lat: -30.75, lon: 121.47, radiusKm: 220 },
  { match: /\bsouth interior\b/i, state: "WA", lat: -26.6, lon: 120.2, radiusKm: 280 },
  { match: /\beucalyptus\b|\beucla\b/i, state: "WA", lat: -31.7, lon: 128.9, radiusKm: 200 },
  { match: /\beast gippsland\b/i, state: "VIC", lat: -37.5, lon: 148.5, radiusKm: 140 },
  { match: /\bwest (and )?south gippsland\b|\bsouth gippsland\b/i, state: "VIC", lat: -38.5, lon: 146.0, radiusKm: 120 },
  { match: /\bnorth east\b/i, state: "VIC", lat: -36.4, lon: 146.7, radiusKm: 140 },
  { match: /\bnorthern country\b/i, state: "VIC", lat: -36.4, lon: 145.4, radiusKm: 140 },
  { match: /\bcentral\b/i, state: "VIC", lat: -37.5, lon: 144.5, radiusKm: 110 },
  { match: /\bmallee\b/i, state: "VIC", lat: -35.0, lon: 142.2, radiusKm: 160 },
  { match: /\bwimmera\b/i, state: "VIC", lat: -36.7, lon: 142.2, radiusKm: 130 },
  { match: /\briverina\b/i, state: "NSW", lat: -35.1, lon: 147.4, radiusKm: 180 },
  { match: /\bsouthwest slopes\b/i, state: "NSW", lat: -35.1, lon: 148.0, radiusKm: 140 },
  { match: /\bcentral west slopes\b|\bcentral west plains\b|\bcentral west\b/i, state: "NSW", lat: -33.3, lon: 148.0, radiusKm: 160 },
  { match: /\bnorthwest slopes\b|\bnorth west slopes\b/i, state: "NSW", lat: -30.3, lon: 150.0, radiusKm: 150 },
  { match: /\bnorthern tablelands\b/i, state: "NSW", lat: -30.5, lon: 151.7, radiusKm: 140 },
  { match: /\bmid.?north coast\b/i, state: "NSW", lat: -31.4, lon: 152.8, radiusKm: 120 },
  { match: /\bnorth coast\b/i, state: "NSW", lat: -29.5, lon: 153.0, radiusKm: 130 },
  { match: /\billawarra\b/i, state: "NSW", lat: -34.5, lon: 150.8, radiusKm: 90 },
  { match: /\bsydney\b/i, state: "NSW", lat: -33.87, lon: 151.21, radiusKm: 80 },
  { match: /\bhunter\b/i, state: "NSW", lat: -32.7, lon: 151.4, radiusKm: 110 },
  { match: /\bcentral tablelands\b/i, state: "NSW", lat: -33.3, lon: 149.1, radiusKm: 120 },
  { match: /\bsouth coast\b/i, state: "NSW", lat: -36.0, lon: 150.0, radiusKm: 130 },
  { match: /\bwestern\b/i, state: "NSW", lat: -31.5, lon: 145.0, radiusKm: 220 },
  { match: /\bsouth east coast\b/i, state: "QLD", lat: -27.5, lon: 153.0, radiusKm: 120 },
  { match: /\bdarling downs\b/i, state: "QLD", lat: -27.6, lon: 151.9, radiusKm: 140 },
  { match: /\bmaranoa\b|\bwarrego\b/i, state: "QLD", lat: -26.6, lon: 148.8, radiusKm: 180 },
  { match: /\bcentral coast\b/i, state: "QLD", lat: -23.4, lon: 150.5, radiusKm: 140 },
  { match: /\bwide bay\b/i, state: "QLD", lat: -25.5, lon: 152.7, radiusKm: 130 },
  { match: /\bcapricornia\b/i, state: "QLD", lat: -23.4, lon: 150.5, radiusKm: 140 },
  { match: /\bherbert\b|\bgulf country\b/i, state: "QLD", lat: -18.0, lon: 141.0, radiusKm: 220 },
  { match: /\bnorth tropical coast\b|\bcairns\b/i, state: "QLD", lat: -16.9, lon: 145.8, radiusKm: 120 },
  { match: /\badelaide\b/i, state: "SA", lat: -34.93, lon: 138.6, radiusKm: 90 },
  { match: /\bmount lofty\b/i, state: "SA", lat: -35.0, lon: 138.7, radiusKm: 80 },
  { match: /\bmurraylands\b/i, state: "SA", lat: -35.1, lon: 139.3, radiusKm: 120 },
  { match: /\briverland\b/i, state: "SA", lat: -34.2, lon: 140.7, radiusKm: 110 },
  { match: /\bflinders\b/i, state: "SA", lat: -32.5, lon: 138.0, radiusKm: 160 },
  { match: /\bwest coast\b/i, state: "SA", lat: -33.0, lon: 135.0, radiusKm: 180 },
  { match: /\bkangaroo island\b/i, state: "SA", lat: -35.8, lon: 137.3, radiusKm: 80 },
  { match: /\bdarwin\b|\barafura\b/i, state: "NT", lat: -12.46, lon: 130.84, radiusKm: 140 },
  { match: /\balice\b|\blesser\b/i, state: "NT", lat: -23.7, lon: 133.88, radiusKm: 180 },
  { match: /\bbarkly\b/i, state: "NT", lat: -19.65, lon: 134.18, radiusKm: 200 },
];

function maxCategory(
  a: BomRiskCategoryId | null,
  b: BomRiskCategoryId | null,
): BomRiskCategoryId | null {
  if (!a) return b;
  if (!b) return a;
  return CATEGORY_RANK[a] >= CATEGORY_RANK[b] ? a : b;
}

/** Classify BoM daily forecast wording into the 4-level convective key. */
export function classifyBomForecastText(
  icon: string | null | undefined,
  shortText: string | null | undefined,
  extendedText: string | null | undefined,
): BomRiskCategoryId | null {
  const text = `${shortText ?? ""} ${extendedText ?? ""}`.toLowerCase();
  const hasStormWord =
    /\bthunder|\bt-?storms?\b|\bstorms?\b/.test(text) || icon === "storm";
  if (!hasStormWord) return null;

  if (
    /severe\s+thunderstorms?\s+(are\s+)?likely/.test(text) ||
    /likely\s+severe\s+thunderstorms?/.test(text) ||
    /dangerous\s+severe/.test(text)
  ) {
    return "severe_likely";
  }

  if (
    /severe\s+thunderstorm/.test(text) ||
    /possible\s+severe/.test(text) ||
    /chance\s+of\s+(a\s+)?severe\s+thunder/.test(text)
  ) {
    return "severe_possible";
  }

  if (
    /thunderstorms?\s+(are\s+)?likely/.test(text) ||
    /likely\s+thunderstorms?/.test(text) ||
    /thunderstorms?\s+most\s+likely/.test(text)
  ) {
    return "tstm_likely";
  }

  // "Possible late storm", "chance of a thunderstorm", icon storm alone.
  if (
    /likely/.test(text) &&
    /\bthunder|\bstorm/.test(text) &&
    !/slight\s+chance|possible/.test(text)
  ) {
    return "tstm_likely";
  }

  return "tstm_possible";
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function cellPolygon(lat: number, lon: number): GeoJsonGeometry {
  const dLat = CELL_HALF_DEG;
  const dLon = CELL_HALF_DEG / Math.max(0.35, Math.cos((lat * Math.PI) / 180));
  const ring: number[][] = [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
  return { type: "Polygon", coordinates: [ring] };
}

async function bomGetJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": FETCH_UA,
        },
        cache: "no-store",
        next: { revalidate: 0 },
        signal: controller.signal,
      });
      if (!res.ok) {
        // Retry transient upstream pressure.
        if ((res.status === 429 || res.status >= 500) && attempt < FETCH_RETRIES) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          continue;
        }
        throw new Error(`BoM ${res.status} for ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function mapWaves<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += WAVE_SIZE) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, WAVE_PAUSE_MS));
    }
    const batch = items.slice(i, i + WAVE_SIZE);
    const rows = await mapPool(batch, WAVE_CONCURRENCY, fn);
    out.push(...rows);
  }
  return out;
}

type SiteDayRisk = {
  site: BomRiskSite;
  days: Array<{
    date: string;
    category: BomRiskCategoryId | null;
  }>;
};

async function fetchSiteRisk(
  site: BomRiskSite,
): Promise<SiteDayRisk & { ok: boolean }> {
  // Prefer 6-char grid hash — matches BoM forecast grid keys more reliably.
  const geohash =
    site.geohash.length > 6 ? site.geohash.slice(0, 6) : site.geohash;
  try {
    const payload = await bomGetJson<{ data?: DailyRow[] }>(
      `${BOM_API}/locations/${encodeURIComponent(geohash)}/forecasts/daily`,
    );
    const rows = payload.data ?? [];
    if (!rows.length) {
      return {
        site,
        ok: false,
        days: [
          { date: "", category: null },
          { date: "", category: null },
          { date: "", category: null },
        ],
      };
    }
    const days = [0, 1, 2].map((i) => {
      const row = rows[i];
      if (!row) return { date: "", category: null as BomRiskCategoryId | null };
      return {
        date: String(row.date ?? ""),
        category: classifyBomForecastText(
          row.icon_descriptor,
          row.short_text,
          row.extended_text,
        ),
      };
    });
    return { site, ok: true, days };
  } catch {
    return {
      site,
      ok: false,
      days: [
        { date: "", category: null },
        { date: "", category: null },
        { date: "", category: null },
      ],
    };
  }
}

function parseDistrictTokens(title: string): string[] {
  const cleaned = title
    .replace(/forecast districts?/gi, "")
    .replace(/districts?/gi, "")
    .trim();
  return cleaned
    .split(/,|\band\b/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

async function severeWarningTargets(): Promise<{
  issueTimes: string[];
  targets: Array<{ state: string; lat: number; lon: number; radiusKm: number }>;
}> {
  try {
    const list = await bomGetJson<{ data?: WarningSummary[] }>(
      `${BOM_API}/warnings`,
    );
    const severe = (list.data ?? []).filter((w) => {
      const type = (w.type ?? "").toLowerCase();
      const phase = (w.phase ?? "").toLowerCase();
      if (phase.includes("cancel")) return false;
      return type === "severe_thunderstorm_warning";
    });

    const targets: Array<{
      state: string;
      lat: number;
      lon: number;
      radiusKm: number;
    }> = [];
    const issueTimes: string[] = [];

    for (const w of severe) {
      if (w.issue_time) issueTimes.push(w.issue_time);
      const states = (w.states?.length ? w.states : w.state ? [w.state] : []).map(
        (s) => s.toUpperCase(),
      );
      const title = w.title ?? "";
      const tokens = parseDistrictTokens(title);
      let matched = false;

      for (const district of FORECAST_DISTRICT_CENTRES) {
        if (!district.match.test(title)) continue;
        if (states.length && !states.includes(district.state)) continue;
        targets.push({
          state: district.state,
          lat: district.lat,
          lon: district.lon,
          radiusKm: district.radiusKm,
        });
        matched = true;
      }

      // Fall back: match token text against sample site names in the warned state.
      if (!matched) {
        for (const token of tokens) {
          const tok = token.toLowerCase();
          for (const site of BOM_RISK_SITES) {
            if (states.length && !states.includes(site.state.toUpperCase())) {
              continue;
            }
            if (site.name.toLowerCase().includes(tok) || tok.includes(site.name.toLowerCase())) {
              targets.push({
                state: site.state,
                lat: site.lat,
                lon: site.lon,
                radiusKm: 140,
              });
              matched = true;
            }
          }
        }
      }

      // Last resort: state centroid bump for sites that already show storms.
      if (!matched) {
        for (const state of states) {
          const inState = BOM_RISK_SITES.filter(
            (s) => s.state.toUpperCase() === state,
          );
          if (!inState.length) continue;
          const lat =
            inState.reduce((a, s) => a + s.lat, 0) / inState.length;
          const lon =
            inState.reduce((a, s) => a + s.lon, 0) / inState.length;
          targets.push({ state, lat, lon, radiusKm: 320 });
        }
      }
    }

    return { issueTimes, targets };
  } catch {
    return { issueTimes: [], targets: [] };
  }
}

function applySevereTargets(
  category: BomRiskCategoryId | null,
  site: BomRiskSite,
  targets: Array<{ state: string; lat: number; lon: number; radiusKm: number }>,
): BomRiskCategoryId | null {
  if (!targets.length) return category;
  const hit = targets.some((t) => {
    if (t.state && site.state.toUpperCase() !== t.state.toUpperCase()) return false;
    return haversineKm(site.lat, site.lon, t.lat, t.lon) <= t.radiusKm;
  });
  if (!hit) return category;
  // Active severe thunderstorm warning ⇒ severe likely in the warned area.
  return maxCategory(category, "severe_likely");
}

function styleForCategory(id: BomRiskCategoryId) {
  const item = bomLegendItems().find((x) => x.id === id);
  return (
    item?.style ?? {
      fillColor: "#64748b",
      fillOpacity: 0.55,
      strokeColor: "#111827",
      strokeOpacity: 0.9,
      strokeWidth: 1.25,
      hatch: "none",
    }
  );
}

function buildDayFeatures(
  dayIndex: 0 | 1 | 2,
  samples: SiteDayRisk[],
  severeTargets: Array<{
    state: string;
    lat: number;
    lon: number;
    radiusKm: number;
  }>,
): DisplayFeature[] {
  const features: DisplayFeature[] = [];

  for (const sample of samples) {
    let category = sample.days[dayIndex]?.category ?? null;
    if (dayIndex === 0) {
      category = applySevereTargets(category, sample.site, severeTargets);
    }
    if (!category) continue;

    features.push({
      id: `bom-${sample.site.geohash}-d${dayIndex + 1}-${category}`,
      geometry: cellPolygon(sample.site.lat, sample.site.lon),
      title: CATEGORY_LABEL[category],
      categoryId: category,
      order: CATEGORY_ORDER[category],
      style: styleForCategory(category),
    });
  }

  features.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return features;
}

function legendFor(features: DisplayFeature[]): DisplayLegendItem[] {
  const used = new Set(features.map((f) => f.categoryId));
  return bomLegendItems().map((item) => ({
    ...item,
    used: used.has(item.id),
  }));
}

function dayDateIso(samples: SiteDayRisk[], dayIndex: number): string {
  for (const s of samples) {
    const d = s.days[dayIndex]?.date;
    if (d) return d;
  }
  return "";
}

async function buildLiveOutlook(): Promise<PublicForecastResponse> {
  const severePromise = severeWarningTargets();
  const firstPass = await mapWaves(BOM_RISK_SITES, fetchSiteRisk);
  const severe = await severePromise;
  const sitesOkFirstPass = firstPass.filter((s) => s.ok).length;

  const byHash = new Map(firstPass.map((s) => [s.site.geohash, s]));
  const failed = firstPass.filter((s) => !s.ok).map((s) => s.site);
  // One paced retry wave for leftovers.
  if (failed.length > 0) {
    await new Promise((r) => setTimeout(r, 1200));
    const retry = await mapWaves(failed, fetchSiteRisk);
    for (const row of retry) {
      if (row.ok) byHash.set(row.site.geohash, row);
    }
  }

  const samples: SiteDayRisk[] = [...byHash.values()];
  const sitesOk = samples.filter((s) => s.days.some((d) => d.date)).length;

  const labels = bomRiskDayLabels();
  const days = ([0, 1, 2] as const).map((dayIndex) => {
    const effectiveDay = (dayIndex + 1) as 1 | 2 | 3;
    const features = buildDayFeatures(dayIndex, samples, severe.targets);
    const validDate = dayDateIso(samples, dayIndex);
    return {
      effectiveDay,
      storedDay: effectiveDay,
      validDate: validDate || new Date().toISOString(),
      label: labels[effectiveDay].label,
      dateLabel: labels[effectiveDay].dateLabel,
      isToday: effectiveDay === 1,
      features,
      legend: legendFor(features),
      source: "categorical" as const,
    };
  });

  const anyFeatures = days.some((d) => d.features.length > 0);
  const issuedAt =
    severe.issueTimes.sort().at(-1) ??
    samples.find((s) => s.days[0]?.date)?.days[0]?.date ??
    new Date().toISOString();

  return {
    status: anyFeatures ? "ok" : "empty",
    issuedAt,
    mapView: { center: [-25.5, 134.5], zoom: 4.5 },
    days,
    defaultDay: 1,
    message: anyFeatures
      ? undefined
      : "No thunderstorm risk in the current BoM Day 1–3 forecasts.",
    // Lightweight ingest health for ops (ignored by the UI).
    meta: {
      sitesTotal: BOM_RISK_SITES.length,
      sitesOkFirstPass,
      sitesOk,
      severeWarningTargets: severe.targets.length,
    },
  } as PublicForecastResponse & {
    meta: {
      sitesTotal: number;
      sitesOkFirstPass: number;
      sitesOk: number;
      severeWarningTargets: number;
    };
  };
}

/** Public entry — cached live BoM risk outlook for `/risk`. */
export async function getBomRiskOutlook(
  opts: { force?: boolean } = {},
): Promise<PublicForecastResponse> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < CACHE_MS) {
    return cache.value;
  }
  if (!opts.force && inflight) return inflight;

  inflight = buildLiveOutlook()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
