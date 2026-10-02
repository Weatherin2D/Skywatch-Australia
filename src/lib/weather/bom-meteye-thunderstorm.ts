/**
 * Official BoM MetEye thunderstorm forecast (IDZ73094 / ADFD WxThunderstorm).
 *
 * This is the same national layer MetEye shows under Weather → Thunderstorms:
 * 3-hourly Chance / Likely areas from the Australian Digital Forecast Database.
 * Day 1–3 charts are daily max composites of those 3-hourly frames.
 */

import { PNG } from "pngjs";
import type {
  DisplayLegendItem,
  PublicForecastResponse,
} from "@/lib/forecast/types";
import { bomRiskDayLabels } from "@/lib/weather/bom-thunderstorm";
import {
  BOM_METEYE_IMAGE_BOUNDS,
  METEYE_THUNDERSTORM_CATEGORIES,
} from "@/lib/weather/bom-meteye-constants";
import { listAvailableThunderstormCharts } from "@/lib/weather/bom-thunderstorm-charts";

export {
  BOM_METEYE_IMAGE_BOUNDS,
  METEYE_THUNDERSTORM_CATEGORIES,
} from "@/lib/weather/bom-meteye-constants";

export const METEYE_LAYER = "IDZ73094";

const BBOX = `${BOM_METEYE_IMAGE_BOUNDS[0][1]},${BOM_METEYE_IMAGE_BOUNDS[0][0]},${BOM_METEYE_IMAGE_BOUNDS[1][1]},${BOM_METEYE_IMAGE_BOUNDS[1][0]}`;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 760;
const PERIOD_HOURS = 3;
const FORECAST_END_HOURS = 162;

const WMS_HOSTS = [
  "https://wvs1.bom.gov.au/mapcache/meteye",
  "https://wvs2.bom.gov.au/mapcache/meteye",
  "https://wvs3.bom.gov.au/mapcache/meteye",
  "https://wvs4.bom.gov.au/mapcache/meteye",
];

const METADATA_URL =
  "https://www.bom.gov.au/products/grid-metadata/IDZ73094.json";

const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CACHE_MS = 10 * 60_000;

type GridMeta = {
  idcode: string;
  basetime: string;
  issuetime: string;
};

type DayComposite = {
  png: Buffer;
  usedRanks: Set<number>;
  timesteps: number[];
};

type CacheBundle = {
  at: number;
  meta: GridMeta;
  issuedAtIso: string;
  days: Record<1 | 2 | 3, DayComposite | null>;
  outlook: PublicForecastResponse;
};

let cache: CacheBundle | null = null;
let inflight: Promise<CacheBundle> | null = null;

function bomHeaders(): HeadersInit {
  return {
    "User-Agent": FETCH_UA,
    Accept: "*/*",
    Referer: "https://www.bom.gov.au/australia/meteye/",
  };
}

async function fetchBuffer(url: string, timeoutMs = 20_000): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: bomHeaders(),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function parseBomStamp(stamp: string): Date {
  // YYYYMMDDHHmm[ss]
  const y = Number(stamp.slice(0, 4));
  const mo = Number(stamp.slice(4, 6));
  const d = Number(stamp.slice(6, 8));
  const h = Number(stamp.slice(8, 10) || "0");
  const mi = Number(stamp.slice(10, 12) || "0");
  const s = Number(stamp.slice(12, 14) || "0");
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

function formatIssuedAtIso(issuetime: string): string {
  return parseBomStamp(issuetime).toISOString();
}

async function fetchGridMeta(): Promise<GridMeta> {
  const buf = await fetchBuffer(METADATA_URL);
  const json = JSON.parse(buf.toString("utf8")) as {
    metadata?: GridMeta[];
  };
  const row = json.metadata?.[0];
  if (!row?.basetime || !row?.issuetime) {
    throw new Error("IDZ73094 metadata missing basetime/issuetime");
  }
  return {
    idcode: row.idcode || METEYE_LAYER,
    basetime: row.basetime,
    issuetime: row.issuetime,
  };
}

/** Sydney calendar midnights for Day 1–3 relative to "now". */
function sydneyDayWindows(now = new Date()): Record<
  1 | 2 | 3,
  { startMs: number; endMs: number; dateLabel: string; validDate: string }
> {
  const fmtYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayYmd = fmtYmd.format(now); // YYYY-MM-DD
  const [y, m, d] = todayYmd.split("-").map(Number);
  const labels = bomRiskDayLabels(now);
  const out = {} as Record<
    1 | 2 | 3,
    { startMs: number; endMs: number; dateLabel: string; validDate: string }
  >;

  for (const day of [1, 2, 3] as const) {
    const target = new Date(Date.UTC(y!, m! - 1, d! + (day - 1)));
    const targetYmd = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}`;
    const startMs = findSydneyMidnightUtc(targetYmd);
    out[day] = {
      startMs,
      endMs: startMs + 24 * 3600_000,
      dateLabel: labels[day].dateLabel,
      validDate: `${targetYmd}T00:00:00+10:00`,
    };
  }
  return out;
}

function findSydneyMidnightUtc(ymd: string): number {
  // ymd = YYYY-MM-DD in Sydney. Search UTC candidates from ymd 14:00Z previous
  // calendar day through ymd 16:00Z.
  const [y, m, d] = ymd.split("-").map(Number);
  const startProbe = Date.UTC(y!, m! - 1, d! - 1, 12, 0, 0);
  for (let ms = startProbe; ms <= startProbe + 36 * 3600_000; ms += 15 * 60_000) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    if (
      `${get("year")}-${get("month")}-${get("day")}` === ymd &&
      get("hour") === "00" &&
      get("minute") === "00"
    ) {
      return ms;
    }
  }
  // Fallback AEST
  return Date.UTC(y!, m! - 1, d!, 0, 0, 0) - 10 * 3600_000;
}

/** TIMESTEP values (hours from basetime) that overlap a Sydney local day. */
export function timestepsForSydneyDay(
  basetime: string,
  dayStartMs: number,
  dayEndMs: number,
): number[] {
  // Metadata basetime is YYYYMMDDHH or YYYYMMDDHHmm[ss] (UTC).
  const baseMs = parseBomStamp(basetime).getTime();
  const steps: number[] = [];
  for (let ts = 0; ts <= FORECAST_END_HOURS; ts += PERIOD_HOURS) {
    const validStart = baseMs + ts * 3600_000;
    const validEnd = validStart + PERIOD_HOURS * 3600_000;
    if (validStart < dayEndMs && validEnd > dayStartMs) {
      steps.push(ts);
    }
  }
  return steps;
}

function wmsUrl(host: string, issuetime: string, timestep: number): string {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: METEYE_LAYER,
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX,
    WIDTH: String(MAP_WIDTH),
    HEIGHT: String(MAP_HEIGHT),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
    TIMESTEP: String(timestep),
    ISSUETIME: issuetime,
    // Some mapcache builds also honour BASETIME; harmless if ignored.
  });
  return `${host}?${params.toString()}`;
}

async function fetchTimestepPng(
  issuetime: string,
  timestep: number,
): Promise<Buffer> {
  let lastErr: unknown;
  for (const host of WMS_HOSTS) {
    try {
      const buf = await fetchBuffer(wmsUrl(host, issuetime, timestep));
      // PNG magic
      if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) {
        return buf;
      }
      lastErr = new Error(`Non-PNG from ${host}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`GetMap failed for TIMESTEP=${timestep}`);
}

/** Rank a MetEye pixel: 0 none, 1 chance (teal), 2 likely (red). */
function rankPixel(r: number, g: number, b: number, a: number): number {
  if (a < 20) return 0;
  // Near-white / nodata grey
  if (r > 220 && g > 220 && b > 220) return 0;
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r > 180) return 0;

  // Likely — red family (#DB0303)
  if (r > 150 && g < 90 && b < 90) return 2;
  // Chance — teal family (#00B193)
  if (g > 120 && b > 100 && r < 80) return 1;
  // Soft anti-alias toward red
  if (r > g + 40 && r > b + 40 && r > 100) return 2;
  // Soft anti-alias toward teal
  if (g > r + 40 && b > r + 20 && g > 100) return 1;
  return 0;
}

function decodePng(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

function meteyeLegend(usedRanks: Set<number>): DisplayLegendItem[] {
  return METEYE_THUNDERSTORM_CATEGORIES.map((c, order) => ({
    id: c.id,
    label: c.label,
    order,
    style: {
      fillColor: c.color,
      fillOpacity: 0.7,
      strokeColor: c.color,
      strokeOpacity: 0.95,
      strokeWidth: 1.5,
      hatch: "none" as const,
    },
    used: usedRanks.has(c.rank),
  }));
}

/**
 * Pick the MetEye TIMESTEP that matches what MetEye shows for that day —
 * one 3-hourly frame, not a daily-max union (which overstates coverage).
 *
 * Day 1: the period containing "now" (else the next remaining step).
 * Day 2–3: the step closest to 15:00 Australia/Sydney (peak heating).
 */
function pickRepresentativeTimestep(
  basetime: string,
  steps: number[],
  day: 1 | 2 | 3,
  dayStartMs: number,
  nowMs = Date.now(),
): number | null {
  if (!steps.length) return null;
  const baseMs = parseBomStamp(basetime).getTime();

  if (day === 1) {
    for (const ts of steps) {
      const start = baseMs + ts * 3600_000;
      const end = start + PERIOD_HOURS * 3600_000;
      if (nowMs >= start && nowMs < end) return ts;
    }
    const upcoming = steps.find((ts) => baseMs + ts * 3600_000 >= nowMs);
    return upcoming ?? steps[steps.length - 1]!;
  }

  // Target 15:00 Sydney on that civil day.
  const targetLocal = dayStartMs + 15 * 3600_000;
  let best = steps[0]!;
  let bestDist = Infinity;
  for (const ts of steps) {
    const mid = baseMs + ts * 3600_000 + (PERIOD_HOURS * 3600_000) / 2;
    const dist = Math.abs(mid - targetLocal);
    if (dist < bestDist) {
      bestDist = dist;
      best = ts;
    }
  }
  return best;
}

function frameToComposite(frame: Buffer, timestep: number): DayComposite {
  const png = decodePng(frame);
  const usedRanks = new Set<number>();
  const out = new PNG({ width: png.width, height: png.height });

  for (let i = 0, p = 0; i < png.width * png.height; i++, p += 4) {
    const rank = rankPixel(
      png.data[p]!,
      png.data[p + 1]!,
      png.data[p + 2]!,
      png.data[p + 3]!,
    );
    if (!rank) {
      out.data[p] = 0;
      out.data[p + 1] = 0;
      out.data[p + 2] = 0;
      out.data[p + 3] = 0;
      continue;
    }
    usedRanks.add(rank);
    out.data[p] = png.data[p]!;
    out.data[p + 1] = png.data[p + 1]!;
    out.data[p + 2] = png.data[p + 2]!;
    out.data[p + 3] = Math.min(210, png.data[p + 3]!);
  }

  return {
    png: PNG.sync.write(out),
    usedRanks,
    timesteps: [timestep],
  };
}

async function buildDayComposite(
  meta: GridMeta,
  day: 1 | 2 | 3,
  windows: ReturnType<typeof sydneyDayWindows>,
): Promise<DayComposite | null> {
  const win = windows[day];
  const steps = timestepsForSydneyDay(meta.basetime, win.startMs, win.endMs);
  if (!steps.length) return null;

  const picked = pickRepresentativeTimestep(
    meta.basetime,
    steps,
    day,
    win.startMs,
  );
  if (picked == null) return null;

  try {
    const frame = await fetchTimestepPng(meta.issuetime, picked);
    return frameToComposite(frame, picked);
  } catch (err) {
    console.warn(`[meteye] TIMESTEP ${picked} failed`, err);
    // Fall back through remaining steps for that day.
    for (const ts of steps) {
      if (ts === picked) continue;
      try {
        const frame = await fetchTimestepPng(meta.issuetime, ts);
        return frameToComposite(frame, ts);
      } catch {
        /* try next */
      }
    }
    return null;
  }
}

async function buildBundle(): Promise<CacheBundle> {
  const meta = await fetchGridMeta();
  const windows = sydneyDayWindows();
  const issuedAtIso = formatIssuedAtIso(meta.issuetime);
  const labels = bomRiskDayLabels();

  const days: Record<1 | 2 | 3, DayComposite | null> = {
    1: null,
    2: null,
    3: null,
  };

  // Build sequentially to be gentle on BoM WMS.
  for (const day of [1, 2, 3] as const) {
    days[day] = await buildDayComposite(meta, day, windows);
  }

  const rolled = ([1, 2, 3] as const).map((effectiveDay) => {
    const comp = days[effectiveDay];
    const used = comp?.usedRanks ?? new Set<number>();
    return {
      effectiveDay,
      storedDay: effectiveDay,
      validDate: windows[effectiveDay].validDate,
      label: labels[effectiveDay].label,
      dateLabel: labels[effectiveDay].dateLabel,
      isToday: effectiveDay === 1,
      features: [],
      legend: meteyeLegend(used),
      source: "categorical" as const,
    };
  });

  const any = rolled.some((d) => d.legend.some((l) => l.used));

  const chartLists = await Promise.all(
    ([1, 2] as const).map(async (day) =>
      (await listAvailableThunderstormCharts(day)).map((c) => ({
        day,
        regionId: c.regionId,
        productId: c.productId,
      })),
    ),
  );
  const availableCharts = chartLists.flat();
  // Prefer an official Thunderstorm Forecast chart region when BoM has published one.
  const defaultRegion =
    availableCharts.find((c) => c.day === 1)?.regionId ??
    availableCharts[0]?.regionId ??
    null;

  const outlook: PublicForecastResponse = {
    status: any || availableCharts.length > 0 ? "ok" : "empty",
    issuedAt: issuedAtIso,
    mapView: { center: [-25.5, 134.5], zoom: 4.5 },
    days: rolled,
    defaultDay: 1,
    availableCharts,
    defaultRegion,
    message:
      any || availableCharts.length > 0
        ? undefined
        : "No thunderstorm areas in the current BoM MetEye Day 1–3 forecast.",
  };

  return {
    at: Date.now(),
    meta,
    issuedAtIso,
    days,
    outlook,
  };
}

async function getBundle(opts: { force?: boolean } = {}): Promise<CacheBundle> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < CACHE_MS) return cache;
  if (!opts.force && inflight) return inflight;

  inflight = buildBundle()
    .then((value) => {
      cache = value;
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Cached MetEye-backed Day 1–3 outlook for `/api/forecast` and `/risk`. */
export async function getMeteyeThunderstormOutlook(
  opts: { force?: boolean } = {},
): Promise<PublicForecastResponse> {
  const bundle = await getBundle(opts);
  return bundle.outlook;
}

/** Official daily-max MetEye thunderstorm PNG for Leaflet ImageOverlay. */
export async function getMeteyeThunderstormDayPng(
  day: 1 | 2 | 3,
  opts: { force?: boolean } = {},
): Promise<{ png: Buffer; issuedAt: string; empty: boolean } | null> {
  const bundle = await getBundle(opts);
  const comp = bundle.days[day];
  if (!comp) return null;
  return {
    png: comp.png,
    issuedAt: bundle.issuedAtIso,
    empty: comp.usedRanks.size === 0,
  };
}
