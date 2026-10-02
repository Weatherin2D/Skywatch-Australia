/**
 * Official BoM MetEye thunderstorm forecast (IDZ73094 / ADFD WxThunderstorm).
 *
 * Same national layer MetEye shows under Weather → Thunderstorms:
 * 3-hourly Chance / Likely areas for the full MetEye horizon (~7 days /
 * TIMESTEP 0–162).
 */

import { PNG } from "pngjs";
import type {
  DisplayLegendItem,
  PublicForecastResponse,
  RolledDay,
} from "@/lib/forecast/types";
import {
  BOM_METEYE_IMAGE_BOUNDS,
  METEYE_THUNDERSTORM_CATEGORIES,
} from "@/lib/weather/bom-meteye-constants";

export {
  BOM_METEYE_IMAGE_BOUNDS,
  METEYE_THUNDERSTORM_CATEGORIES,
} from "@/lib/weather/bom-meteye-constants";

export const METEYE_LAYER = "IDZ73094";
/** MetEye `timeline.3hourly7days` forecastEnd. */
export const METEYE_FORECAST_END_HOURS = 162;
export const METEYE_PERIOD_HOURS = 3;

const BBOX = `${BOM_METEYE_IMAGE_BOUNDS[0][1]},${BOM_METEYE_IMAGE_BOUNDS[0][0]},${BOM_METEYE_IMAGE_BOUNDS[1][1]},${BOM_METEYE_IMAGE_BOUNDS[1][0]}`;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 760;

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

type DayWindow = {
  day: number;
  startMs: number;
  endMs: number;
  dateLabel: string;
  validDate: string;
  label: string;
};

type DayFrame = {
  png: Buffer;
  usedRanks: Set<number>;
  timestep: number;
};

type CacheBundle = {
  at: number;
  meta: GridMeta;
  issuedAtIso: string;
  days: Map<number, DayFrame>;
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

function findSydneyMidnightUtc(ymd: string): number {
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
  return Date.UTC(y!, m! - 1, d!, 0, 0, 0) - 10 * 3600_000;
}

function sydneyYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function formatDayLabel(day: number, ymd: string): { label: string; dateLabel: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(noon);
  return {
    label: day === 1 ? "Day 1 · Today" : `Day ${day}`,
    dateLabel,
  };
}

/**
 * Sydney calendar days covered by MetEye TIMESTEP 0…forecastEnd from basetime,
 * starting at "today" in Sydney.
 */
export function meteyeDayWindows(
  basetime: string,
  now = new Date(),
): DayWindow[] {
  const baseMs = parseBomStamp(basetime).getTime();
  const forecastEndMs =
    baseMs + (METEYE_FORECAST_END_HOURS + METEYE_PERIOD_HOURS) * 3600_000;
  const todayYmd = sydneyYmd(now.getTime());
  const todayStart = findSydneyMidnightUtc(todayYmd);

  const windows: DayWindow[] = [];
  for (let day = 1; day <= 8; day++) {
    const startMs = todayStart + (day - 1) * 24 * 3600_000;
    const endMs = startMs + 24 * 3600_000;
    // Keep the day if any MetEye period overlaps it and starts before forecast end.
    if (startMs >= forecastEndMs) break;
    if (endMs <= baseMs) continue;
    const steps = timestepsForSydneyDay(basetime, startMs, endMs);
    if (!steps.length) continue;
    const ymd = sydneyYmd(startMs + 12 * 3600_000);
    const labels = formatDayLabel(day, ymd);
    windows.push({
      day,
      startMs,
      endMs,
      dateLabel: labels.dateLabel,
      validDate: `${ymd}T00:00:00+10:00`,
      label: labels.label,
    });
  }
  return windows;
}

/** TIMESTEP values (hours from basetime) that overlap a Sydney local day. */
export function timestepsForSydneyDay(
  basetime: string,
  dayStartMs: number,
  dayEndMs: number,
): number[] {
  const baseMs = parseBomStamp(basetime).getTime();
  const steps: number[] = [];
  for (let ts = 0; ts <= METEYE_FORECAST_END_HOURS; ts += METEYE_PERIOD_HOURS) {
    const validStart = baseMs + ts * 3600_000;
    const validEnd = validStart + METEYE_PERIOD_HOURS * 3600_000;
    if (validStart < dayEndMs && validEnd > dayStartMs) {
      steps.push(ts);
    }
  }
  return steps;
}

export function isMeteyeOutlookDay(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 8;
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

function rankPixel(r: number, g: number, b: number, a: number): number {
  if (a < 20) return 0;
  if (r > 220 && g > 220 && b > 220) return 0;
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r > 180) return 0;
  if (r > 150 && g < 90 && b < 90) return 2;
  if (g > 120 && b > 100 && r < 80) return 1;
  if (r > g + 40 && r > b + 40 && r > 100) return 2;
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
 * One MetEye TIMESTEP per day — same as scrubbing MetEye to that period.
 * Day 1: period containing "now" (else next remaining).
 * Later days: closest to 15:00 Australia/Sydney.
 */
function pickRepresentativeTimestep(
  basetime: string,
  steps: number[],
  day: number,
  dayStartMs: number,
  nowMs = Date.now(),
): number | null {
  if (!steps.length) return null;
  const baseMs = parseBomStamp(basetime).getTime();

  if (day === 1) {
    for (const ts of steps) {
      const start = baseMs + ts * 3600_000;
      const end = start + METEYE_PERIOD_HOURS * 3600_000;
      if (nowMs >= start && nowMs < end) return ts;
    }
    const upcoming = steps.find((ts) => baseMs + ts * 3600_000 >= nowMs);
    return upcoming ?? steps[steps.length - 1]!;
  }

  const targetLocal = dayStartMs + 15 * 3600_000;
  let best = steps[0]!;
  let bestDist = Infinity;
  for (const ts of steps) {
    const mid =
      baseMs + ts * 3600_000 + (METEYE_PERIOD_HOURS * 3600_000) / 2;
    const dist = Math.abs(mid - targetLocal);
    if (dist < bestDist) {
      bestDist = dist;
      best = ts;
    }
  }
  return best;
}

function frameToDay(frame: Buffer, timestep: number): DayFrame {
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
    timestep,
  };
}

async function buildDayFrame(
  meta: GridMeta,
  win: DayWindow,
): Promise<DayFrame | null> {
  const steps = timestepsForSydneyDay(meta.basetime, win.startMs, win.endMs);
  if (!steps.length) return null;

  const picked = pickRepresentativeTimestep(
    meta.basetime,
    steps,
    win.day,
    win.startMs,
  );
  if (picked == null) return null;

  try {
    const frame = await fetchTimestepPng(meta.issuetime, picked);
    return frameToDay(frame, picked);
  } catch (err) {
    console.warn(`[meteye] TIMESTEP ${picked} failed`, err);
    for (const ts of steps) {
      if (ts === picked) continue;
      try {
        const frame = await fetchTimestepPng(meta.issuetime, ts);
        return frameToDay(frame, ts);
      } catch {
        /* try next */
      }
    }
    return null;
  }
}

async function buildBundle(): Promise<CacheBundle> {
  const meta = await fetchGridMeta();
  const windows = meteyeDayWindows(meta.basetime);
  const issuedAtIso = formatIssuedAtIso(meta.issuetime);
  const dayFrames = new Map<number, DayFrame>();

  // Gentle on BoM WMS — sequential day fetches.
  for (const win of windows) {
    const frame = await buildDayFrame(meta, win);
    if (frame) dayFrames.set(win.day, frame);
  }

  const rolled: RolledDay[] = windows.map((win) => {
    const frame = dayFrames.get(win.day);
    const used = frame?.usedRanks ?? new Set<number>();
    return {
      effectiveDay: win.day,
      storedDay: win.day,
      validDate: win.validDate,
      label: win.label,
      dateLabel: win.dateLabel,
      isToday: win.day === 1,
      features: [],
      legend: meteyeLegend(used),
      source: "categorical" as const,
    };
  });

  const any = rolled.some((d) => d.legend.some((l) => l.used));

  const outlook: PublicForecastResponse = {
    status: any ? "ok" : "empty",
    issuedAt: issuedAtIso,
    mapView: { center: [-25.5, 134.5], zoom: 4.5 },
    days: rolled,
    defaultDay: 1,
    message: any
      ? undefined
      : "No thunderstorm areas in the current BoM MetEye forecast.",
  };

  return {
    at: Date.now(),
    meta,
    issuedAtIso,
    days: dayFrames,
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

/** Cached MetEye outlook for `/api/forecast` and `/risk` (full MetEye horizon). */
export async function getMeteyeThunderstormOutlook(
  opts: { force?: boolean } = {},
): Promise<PublicForecastResponse> {
  const bundle = await getBundle(opts);
  return bundle.outlook;
}

/** MetEye thunderstorm PNG for one outlook day (Leaflet ImageOverlay). */
export async function getMeteyeThunderstormDayPng(
  day: number,
  opts: { force?: boolean } = {},
): Promise<{ png: Buffer; issuedAt: string; empty: boolean } | null> {
  if (!isMeteyeOutlookDay(day)) return null;
  const bundle = await getBundle(opts);
  const frame = bundle.days.get(day);
  if (!frame) return null;
  return {
    png: frame.png,
    issuedAt: bundle.issuedAtIso,
    empty: frame.usedRanks.size === 0,
  };
}
