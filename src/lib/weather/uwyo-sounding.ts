/**
 * University of Wyoming radiosonde fetch + CSV parse.
 * Uses /wsgi/sounding with src=BUFR (legacy cgi-bin is retired).
 */

import { getSoundingStation } from "@/lib/weather/sounding-stations";
import type { SoundingLevel, SoundingPayload } from "@/lib/weather/sounding-types";
import { analyzeSounding } from "@/lib/weather/sounding-thermo";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractCsv(html: string): string | null {
  const marker = "time,longitude,latitude,pressure";
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const chunk = html.slice(idx);
  const end = chunk.search(/\n\s*<\/|\n<script|\n<div/i);
  return (end > 0 ? chunk.slice(0, end) : chunk).trim();
}

function parseCsvLevels(csv: string): {
  levels: SoundingLevel[];
  lat: number;
  lon: number;
  validTime: string | null;
} {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { levels: [], lat: 0, lon: 0, validTime: null };

  const header = lines[0]!.toLowerCase();
  const cols = header.split(",").map((c) => c.trim());
  const iP = cols.findIndex((c) => c.startsWith("pressure"));
  const iZ = cols.findIndex((c) => c.includes("geopotential"));
  const iT = cols.findIndex((c) => c.startsWith("temperature"));
  const iTd = cols.findIndex((c) => c.includes("dew point"));
  const iRh = cols.findIndex((c) => c.startsWith("relative humidity"));
  const iDir = cols.findIndex((c) => c.includes("wind direction"));
  const iSpd = cols.findIndex((c) => c.includes("wind speed"));
  const iLat = cols.findIndex((c) => c === "latitude");
  const iLon = cols.findIndex((c) => c === "longitude");
  const iTime = cols.findIndex((c) => c === "time");

  if (iP < 0 || iT < 0 || iTd < 0) {
    return { levels: [], lat: 0, lon: 0, validTime: null };
  }

  const levels: SoundingLevel[] = [];
  let lat = 0;
  let lon = 0;
  let validTime: string | null = null;

  for (let li = 1; li < lines.length; li++) {
    const parts = lines[li]!.split(",");
    if (parts.length < 6) continue;
    const p = Number(parts[iP]);
    const t = Number(parts[iT]);
    const td = Number(parts[iTd]);
    if (!Number.isFinite(p) || !Number.isFinite(t) || !Number.isFinite(td)) {
      continue;
    }
    const z = iZ >= 0 ? Number(parts[iZ]) : NaN;
    const rh = iRh >= 0 ? Number(parts[iRh]) : NaN;
    const windDir = iDir >= 0 ? Number(parts[iDir]) : NaN;
    const windSpd = iSpd >= 0 ? Number(parts[iSpd]) : NaN;
    if (iLat >= 0 && Number.isFinite(Number(parts[iLat]))) lat = Number(parts[iLat]);
    if (iLon >= 0 && Number.isFinite(Number(parts[iLon]))) lon = Number(parts[iLon]);
    if (!validTime && iTime >= 0 && parts[iTime]) {
      const raw = parts[iTime]!.trim().replace(" ", "T");
      const ms = Date.parse(`${raw}Z`);
      validTime = Number.isFinite(ms) ? new Date(ms).toISOString() : raw;
    }
    levels.push({
      p,
      z: Number.isFinite(z) ? z : 0,
      t,
      td,
      rh: Number.isFinite(rh) ? rh : null,
      windDir: Number.isFinite(windDir) ? windDir : null,
      windSpd: Number.isFinite(windSpd) ? windSpd : null,
    });
  }

  // Sort surface → top (descending pressure).
  levels.sort((a, b) => b.p - a.p);
  return { levels, lat, lon, validTime };
}

async function fetchUwyoCsv(
  wmo: string,
  when: Date,
): Promise<{ ok: true; csv: string } | { ok: false; reason: string }> {
  const params = new URLSearchParams({
    datetime: `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}-${String(when.getUTCDate()).padStart(2, "0")} ${String(when.getUTCHours()).padStart(2, "0")}:00:00`,
    id: wmo,
    type: "TEXT:CSV",
    src: "BUFR",
  });
  const url = `https://weather.uwyo.edu/wsgi/sounding?${params}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,text/plain,*/*",
        "User-Agent": "SkyWatchAustralia/1.0 (+soundings)",
      },
      cache: "no-store",
      // UWYO often hangs on connect — fail fast so Observed doesn't spin forever.
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        reason: text.slice(0, 160) || `UWYO ${res.status}`,
      };
    }
    const csv = extractCsv(text);
    if (!csv || csv.split("\n").length < 5) {
      return { ok: false, reason: "No sounding levels in UWYO response" };
    }
    return { ok: true, csv };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = /aborted|timeout|TimeoutError/i.test(msg);
    return {
      ok: false,
      reason: timedOut
        ? "University of Wyoming radiosonde archive timed out — try Model mode + AI V1"
        : msg,
    };
  }
}

/** Keep mandatory levels + ~every 15 hPa so SVG/payload stay lean. */
function thinLevels(levels: SoundingLevel[]): SoundingLevel[] {
  if (levels.length <= 180) return levels;
  const must = new Set([1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100]);
  const out: SoundingLevel[] = [];
  let lastP = Infinity;
  for (const l of levels) {
    const nearMust = [...must].some((p) => Math.abs(l.p - p) < 3);
    if (nearMust || lastP - l.p >= 15 || out.length === 0) {
      out.push(l);
      lastP = l.p;
    }
  }
  // Always keep top
  const top = levels[levels.length - 1]!;
  if (out[out.length - 1] !== top) out.push(top);
  return out;
}

export type ObservedArchiveSlot = {
  /** Canonical request time ISO (UTC) */
  time: string;
  /** UTC hour of the UWYO inventory slot */
  hour: number;
  /** YYYY-MM-DD (UTC date of inventory datetime) */
  date: string;
  label: string;
};

type InventoryCacheEntry = {
  expires: number;
  slots: ObservedArchiveSlot[];
  stationName: string | null;
  year: number;
};

const inventoryCache = new Map<string, InventoryCacheEntry>();
const INVENTORY_TTL_MS = 30 * 60_000;

function slotLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return (
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d) + " UTC"
  );
}

function parseInventoryHtml(html: string, year: number): ObservedArchiveSlot[] {
  const re =
    /datetime=(\d{4}-\d{2}-\d{2})[ +](\d{2}):(\d{2}):(\d{2})/gi;
  const seen = new Set<string>();
  const slots: ObservedArchiveSlot[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const y = Number(m[1]!.slice(0, 4));
    // Inventory pages include adjacent-year nav links — keep requested year.
    if (y !== year) continue;
    const date = m[1]!;
    const hh = m[2]!;
    const mm = m[3]!;
    const ss = m[4]!;
    const raw = `${date}T${hh}:${mm}:${ss}Z`;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) continue;
    const time = new Date(ms).toISOString();
    if (seen.has(time)) continue;
    seen.add(time);
    slots.push({
      time,
      hour: Number(hh),
      date,
      label: slotLabel(time),
    });
  }
  slots.sort((a, b) => b.time.localeCompare(a.time));
  return slots;
}

async function fetchUwyoInventoryYear(
  wmo: string,
  year: number,
): Promise<{
  slots: ObservedArchiveSlot[];
  stationName: string | null;
}> {
  const cacheKey = `${wmo}:${year}`;
  const hit = inventoryCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    return { slots: hit.slots, stationName: hit.stationName };
  }

  const params = new URLSearchParams({
    datetime: `${year}-06-15 00:00:00`,
    id: wmo,
    type: "INVENTORY",
    src: "BUFR",
  });
  const url = `https://weather.uwyo.edu/wsgi/sounding?${params}`;
  const res = await fetch(url, {
    headers: {
      Accept: "text/html,text/plain,*/*",
      "User-Agent": "SkyWatchAustralia/1.0 (+soundings-archive)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const html = await res.text();
  if (!res.ok) {
    throw new Error(html.slice(0, 160) || `UWYO inventory ${res.status}`);
  }
  const slots = parseInventoryHtml(html, year);
  const nameMatch = html.match(
    /<H3>\s*([^<]+?)\s*(?:,\s*Australia)?\s*<\/H3>/i,
  );
  const stationName = nameMatch?.[1]?.trim() || null;
  inventoryCache.set(cacheKey, {
    expires: Date.now() + INVENTORY_TTL_MS,
    slots,
    stationName,
    year,
  });
  return { slots, stationName };
}

/** UWYO yearly inventory of available observed sounding times. */
export async function fetchObservedSoundingArchive(options: {
  wmo: string;
  /** Calendar years to include (UTC). Defaults to current + previous. */
  years?: number[];
}): Promise<{
  stationId: string;
  stationName: string;
  years: number[];
  slots: ObservedArchiveSlot[];
  attribution: string;
}> {
  const station = getSoundingStation(options.wmo);
  const nowYear = new Date().getUTCFullYear();
  const years =
    options.years?.length
      ? [...new Set(options.years)].sort((a, b) => b - a)
      : [nowYear, nowYear - 1];

  const all: ObservedArchiveSlot[] = [];
  let stationName =
    station != null ? `${station.name}, ${station.state}` : `WMO ${options.wmo}`;

  for (const year of years) {
    try {
      const inv = await fetchUwyoInventoryYear(options.wmo, year);
      all.push(...inv.slots);
      if (inv.stationName) {
        stationName = inv.stationName.includes(",")
          ? inv.stationName
          : `${inv.stationName}, Australia`;
      }
    } catch {
      // Skip missing years (pre-station / empty inventory).
    }
  }

  const seen = new Set<string>();
  const slots = all
    .filter((s) => {
      if (seen.has(s.time)) return false;
      seen.add(s.time);
      return true;
    })
    .sort((a, b) => b.time.localeCompare(a.time));

  return {
    stationId: options.wmo,
    stationName,
    years,
    slots,
    attribution:
      "University of Wyoming Atmospheric Science Radiosonde Archive (BUFR inventory)",
  };
}

/** Candidate 00Z/12Z times, newest first, looking back several days. */
export function recentSoundingSlots(now = new Date()): Date[] {
  const slots: Date[] = [];
  const utc = new Date(now);
  for (let d = 0; d < 6; d++) {
    for (const h of [12, 0]) {
      const t = new Date(
        Date.UTC(
          utc.getUTCFullYear(),
          utc.getUTCMonth(),
          utc.getUTCDate() - d,
          h,
          0,
          0,
        ),
      );
      if (t.getTime() <= now.getTime() + 3_600_000) slots.push(t);
    }
  }
  slots.sort((a, b) => b.getTime() - a.getTime());
  return slots;
}

async function tryObservedSlot(
  wmo: string,
  name: string,
  stationLat: number,
  stationLon: number,
  slot: Date,
): Promise<
  | { ok: true; payload: SoundingPayload }
  | { ok: false; reason: string }
> {
  if (!Number.isFinite(slot.getTime())) {
    return { ok: false, reason: "Invalid time" };
  }
  const result = await fetchUwyoCsv(wmo, slot);
  if (!result.ok) return { ok: false, reason: result.reason };
  const parsed = parseCsvLevels(result.csv);
  if (parsed.levels.length < 8) {
    return { ok: false, reason: "Sounding too shallow" };
  }
  const levels = thinLevels(parsed.levels);
  const analysis = analyzeSounding(levels);
  return {
    ok: true,
    payload: {
      status: "ok",
      mode: "observed",
      model: null,
      stationId: wmo,
      stationName: name,
      latitude: parsed.lat || stationLat,
      longitude: parsed.lon || stationLon,
      validTime: parsed.validTime ?? slot.toISOString(),
      levels,
      params: analysis.params,
      parcelTraces: analysis.parcelTraces,
      attribution:
        "University of Wyoming Atmospheric Science Radiosonde Archive (BUFR)",
    },
  };
}

export async function fetchObservedSounding(options: {
  wmo: string;
  /** ISO time; if omitted, try recent 00/12Z slots then UWYO inventory. */
  time?: string | null;
}): Promise<SoundingPayload> {
  const station = getSoundingStation(options.wmo);
  const name = station
    ? `${station.name}, ${station.state}`
    : `WMO ${options.wmo}`;
  const stationLat = station?.lat ?? 0;
  const stationLon = station?.lon ?? 0;

  const slots = options.time
    ? [new Date(options.time)]
    : recentSoundingSlots();

  let lastReason = "No recent sounding found";
  const isHardTimeout = (reason: string) =>
    /timed out|TimeoutError|aborted due to timeout/i.test(reason);

  for (const slot of slots.slice(0, options.time ? 1 : 4)) {
    const tried = await tryObservedSlot(
      options.wmo,
      name,
      stationLat,
      stationLon,
      slot,
    );
    if (tried.ok) return tried.payload;
    lastReason = tried.reason;
    // UWYO connect hangs = every retry will hang. Bail immediately.
    if (isHardTimeout(tried.reason)) break;
    await sleep(120);
  }

  // Fall back to latest inventory launch when fixed 00/12Z probes miss
  // (common for some AU sites whose BUFR times are 11Z/23Z).
  if (!options.time && !isHardTimeout(lastReason)) {
    try {
      const year = new Date().getUTCFullYear();
      const archive = await fetchObservedSoundingArchive({
        wmo: options.wmo,
        years: [year],
      });
      for (const inv of archive.slots.slice(0, 4)) {
        const tried = await tryObservedSlot(
          options.wmo,
          name,
          stationLat,
          stationLon,
          new Date(inv.time),
        );
        if (tried.ok) return tried.payload;
        lastReason = tried.reason;
        if (isHardTimeout(tried.reason)) break;
        await sleep(100);
      }
    } catch (err) {
      lastReason =
        err instanceof Error ? err.message : "Inventory lookup failed";
    }
  }

  const empty = analyzeSounding([]);
  return {
    status: "empty",
    mode: "observed",
    model: null,
    stationId: options.wmo,
    stationName: name,
    latitude: stationLat,
    longitude: stationLon,
    validTime: null,
    levels: [],
    params: empty.params,
    parcelTraces: empty.parcelTraces,
    attribution:
      "University of Wyoming Atmospheric Science Radiosonde Archive (BUFR)",
    message: `No observed sounding for ${name}. ${lastReason}`,
  };
}
