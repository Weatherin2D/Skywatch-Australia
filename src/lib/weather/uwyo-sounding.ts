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
      signal: AbortSignal.timeout(35_000),
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
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
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

export async function fetchObservedSounding(options: {
  wmo: string;
  /** ISO time; if omitted, try recent 00/12Z slots. */
  time?: string | null;
}): Promise<SoundingPayload> {
  const station = getSoundingStation(options.wmo);
  const name = station
    ? `${station.name}, ${station.state}`
    : `WMO ${options.wmo}`;

  const slots = options.time
    ? [new Date(options.time)]
    : recentSoundingSlots();

  let lastReason = "No recent sounding found";
  for (const slot of slots.slice(0, 10)) {
    if (!Number.isFinite(slot.getTime())) continue;
    const result = await fetchUwyoCsv(options.wmo, slot);
    if (!result.ok) {
      lastReason = result.reason;
      await sleep(120);
      continue;
    }
    const parsed = parseCsvLevels(result.csv);
    if (parsed.levels.length < 8) {
      lastReason = "Sounding too shallow";
      continue;
    }
    const levels = thinLevels(parsed.levels);
    const lat = parsed.lat || station?.lat || 0;
    const lon = parsed.lon || station?.lon || 0;
    const analysis = analyzeSounding(levels);
    return {
      status: "ok",
      mode: "observed",
      model: null,
      stationId: options.wmo,
      stationName: name,
      latitude: lat,
      longitude: lon,
      validTime: parsed.validTime ?? slot.toISOString(),
      levels,
      params: analysis.params,
      parcelTraces: analysis.parcelTraces,
      attribution:
        "University of Wyoming Atmospheric Science Radiosonde Archive (BUFR)",
    };
  }

  const empty = analyzeSounding([]);
  return {
    status: "empty",
    mode: "observed",
    model: null,
    stationId: options.wmo,
    stationName: name,
    latitude: station?.lat ?? 0,
    longitude: station?.lon ?? 0,
    validTime: null,
    levels: [],
    params: empty.params,
    parcelTraces: empty.parcelTraces,
    attribution:
      "University of Wyoming Atmospheric Science Radiosonde Archive (BUFR)",
    message: `No observed sounding for ${name}. ${lastReason}`,
  };
}
