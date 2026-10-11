/**
 * Model Skew-T profiles from Open-Meteo pressure levels.
 */

import type {
  SoundingBoxCell,
  SoundingBoxPayload,
  SoundingBoxSpacingDeg,
  SoundingLevel,
  SoundingModelId,
  SoundingPayload,
} from "@/lib/weather/sounding-types";
import { analyzeSounding } from "@/lib/weather/sounding-thermo";

const PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 700, 650, 600, 550,
  500, 450, 400, 350, 300, 250, 200, 150, 100,
] as const;

/** Slightly coarser ladder for 3×3 box requests (keeps multi-point URL lean). */
const BOX_PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400,
  350, 300, 250, 200, 150, 100,
] as const;

const MODEL_OPEN_METEO: Record<
  SoundingModelId,
  { models: string; label: string }
> = {
  pulse: { models: "best_match", label: "Pulse (Open-Meteo best_match)" },
  ukmo: {
    models: "ukmo_global_deterministic_10km",
    label: "UKMO Global (~10 km)",
  },
  ifs: { models: "ecmwf_ifs", label: "ECMWF IFS HRES" },
  access: { models: "bom_access_global", label: "BoM ACCESS-G" },
};

const BOX_ROW_NS = ["N", "C", "S"] as const;
const BOX_COL_EW = ["W", "C", "E"] as const;

/** Short TTL cache so UI retries / AI attach don't re-hit Open-Meteo 429s. */
const SOUNDING_CACHE_TTL_MS = 12 * 60_000;
const soundingCache = new Map<string, { at: number; payload: SoundingPayload }>();

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function soundingCacheKey(opts: {
  latitude: number;
  longitude: number;
  model: SoundingModelId;
  time?: string | null;
}): string {
  return [
    opts.model,
    opts.latitude.toFixed(3),
    opts.longitude.toFixed(3),
    opts.time ?? "now",
  ].join("|");
}

function pickHourIndex(times: string[], preferIso?: string | null): number {
  if (!times.length) return 0;
  if (preferIso) {
    const target = Date.parse(preferIso);
    if (Number.isFinite(target)) {
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
  }
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

function approxHeightM(pHpa: number): number {
  // Hypsometric approx for missing heights.
  return Math.round(44330 * (1 - (pHpa / 1013.25) ** 0.1903));
}

function hourlyVars(levels: readonly number[]): string[] {
  const hourly: string[] = [];
  for (const p of levels) {
    hourly.push(
      `temperature_${p}hPa`,
      `dew_point_${p}hPa`,
      `relative_humidity_${p}hPa`,
      `wind_speed_${p}hPa`,
      `wind_direction_${p}hPa`,
      `geopotential_height_${p}hPa`,
    );
  }
  return hourly;
}

function levelsFromHourly(
  h: Record<string, unknown[]>,
  hi: number,
  pressures: readonly number[],
): SoundingLevel[] {
  const levels: SoundingLevel[] = [];
  for (const p of pressures) {
    const t = num(h[`temperature_${p}hPa`]?.[hi]);
    const td = num(h[`dew_point_${p}hPa`]?.[hi]);
    if (t == null || td == null) continue;
    const z = num(h[`geopotential_height_${p}hPa`]?.[hi]) ?? approxHeightM(p);
    levels.push({
      p,
      z,
      t,
      td,
      rh: num(h[`relative_humidity_${p}hPa`]?.[hi]),
      windDir: num(h[`wind_direction_${p}hPa`]?.[hi]),
      // Open-Meteo pressure-level wind is km/h → m/s
      windSpd: (() => {
        const kmh = num(h[`wind_speed_${p}hPa`]?.[hi]);
        return kmh == null ? null : kmh / 3.6;
      })(),
    });
  }
  levels.sort((a, b) => b.p - a.p);
  return levels;
}

function formatBoxCoord(lat: number, lon: number): string {
  const ns = lat < 0 ? "S" : "N";
  const ew = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/** Build a north-up 3×3 geographic box around a centre point. */
export function buildSoundingBoxPoints(
  latitude: number,
  longitude: number,
  spacingDeg: SoundingBoxSpacingDeg,
): { row: number; col: number; label: string; lat: number; lon: number }[] {
  const points: {
    row: number;
    col: number;
    label: string;
    lat: number;
    lon: number;
  }[] = [];
  for (let row = 0; row < 3; row++) {
    const dLat = (1 - row) * spacingDeg; // N, C, S
    for (let col = 0; col < 3; col++) {
      const dLon = (col - 1) * spacingDeg; // W, C, E
      const ns = BOX_ROW_NS[row]!;
      const ew = BOX_COL_EW[col]!;
      const label = ns === "C" && ew === "C" ? "Centre" : `${ns}${ew}`;
      points.push({
        row,
        col,
        label,
        lat: Math.round((latitude + dLat) * 1000) / 1000,
        lon: Math.round((longitude + dLon) * 1000) / 1000,
      });
    }
  }
  return points;
}

export async function fetchModelSounding(options: {
  latitude: number;
  longitude: number;
  model: SoundingModelId;
  placeLabel?: string;
  time?: string | null;
}): Promise<SoundingPayload> {
  const meta = MODEL_OPEN_METEO[options.model];
  const cacheKey = soundingCacheKey(options);
  const hit = soundingCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SOUNDING_CACHE_TTL_MS && hit.payload.status === "ok") {
    return {
      ...hit.payload,
      stationName: options.placeLabel ?? hit.payload.stationName,
    };
  }

  const params = new URLSearchParams({
    latitude: options.latitude.toFixed(4),
    longitude: options.longitude.toFixed(4),
    hourly: hourlyVars(PRESSURE_LEVELS).join(","),
    models: meta.models,
    forecast_days: "3",
    timezone: "UTC",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;

  let lastErr = "Open-Meteo failed";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, Math.min(8000, 900 * 2 ** attempt)));
      }
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(40_000),
      });
      if (res.status === 429) {
        lastErr = "Open-Meteo rate limited — retry in a moment";
        const retryAfter = Number(res.headers.get("retry-after"));
        await new Promise((r) =>
          setTimeout(
            r,
            Number.isFinite(retryAfter)
              ? retryAfter * 1000
              : Math.min(10_000, 1200 * (attempt + 1)),
          ),
        );
        continue;
      }
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const json = (await res.json()) as {
        hourly?: Record<string, unknown[]>;
        latitude?: number;
        longitude?: number;
      };
      const h = json.hourly;
      const times = (h?.time ?? []) as string[];
      if (!h || !times.length) {
        return emptyModel(options, meta.label, "No hourly model data returned");
      }
      const hi = pickHourIndex(times, options.time);
      const levels = levelsFromHourly(h, hi, PRESSURE_LEVELS);
      if (levels.length < 6) {
        return emptyModel(
          options,
          meta.label,
          `${meta.label} pressure levels are currently unavailable for this point.`,
        );
      }
      const valid = times[hi]!;
      const validIso = valid.includes("T")
        ? new Date(`${valid}Z`).toISOString()
        : new Date(valid).toISOString();
      const analysis = analyzeSounding(levels);
      const payload: SoundingPayload = {
        status: "ok",
        mode: "model",
        model: options.model,
        stationId: null,
        stationName: options.placeLabel ?? "Selected location",
        latitude: json.latitude ?? options.latitude,
        longitude: json.longitude ?? options.longitude,
        validTime: validIso,
        levels,
        params: analysis.params,
        parcelTraces: analysis.parcelTraces,
        attribution: `${meta.label} forecast model via Open-Meteo. Guidance only.`,
      };
      soundingCache.set(cacheKey, { at: Date.now(), payload });
      return payload;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  // Stale cache beats an empty Skew-T while Open-Meteo is throttling.
  if (hit?.payload.status === "ok") {
    return {
      ...hit.payload,
      stationName: options.placeLabel ?? hit.payload.stationName,
      attribution: `${hit.payload.attribution} · cached (rate limit)`,
    };
  }
  return emptyModel(options, meta.label, lastErr);
}

/**
 * 3×3 model sounding box around a point (single Open-Meteo multi-location call).
 */
export async function fetchModelSoundingBox(options: {
  latitude: number;
  longitude: number;
  model: SoundingModelId;
  placeLabel?: string;
  time?: string | null;
  spacingDeg?: SoundingBoxSpacingDeg;
}): Promise<SoundingBoxPayload> {
  const spacingDeg = options.spacingDeg ?? 0.5;
  const meta = MODEL_OPEN_METEO[options.model];
  const points = buildSoundingBoxPoints(
    options.latitude,
    options.longitude,
    spacingDeg,
  );
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    hourly: hourlyVars(BOX_PRESSURE_LEVELS).join(","),
    models: meta.models,
    forecast_days: "3",
    timezone: "UTC",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const placeLabel = options.placeLabel ?? "Selected location";

  let lastErr = "Open-Meteo failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(50_000),
      });
      if (res.status === 429) {
        lastErr = "Open-Meteo rate limited";
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const json = (await res.json()) as
        | Array<{
            hourly?: Record<string, unknown[]>;
            latitude?: number;
            longitude?: number;
          }>
        | {
            hourly?: Record<string, unknown[]>;
            latitude?: number;
            longitude?: number;
          };

      const locations = Array.isArray(json) ? json : [json];
      if (!locations.length) {
        return emptyBox(options, spacingDeg, placeLabel, meta.label, lastErr);
      }

      let validTime: string | null = null;
      const cells: SoundingBoxCell[] = [];

      for (let i = 0; i < points.length; i++) {
        const pt = points[i]!;
        const loc = locations[i] ?? locations[0]!;
        const h = loc.hourly;
        const times = (h?.time ?? []) as string[];
        const emptyAnalysis = analyzeSounding([]);
        if (!h || !times.length) {
          cells.push({
            row: pt.row,
            col: pt.col,
            label: pt.label,
            latitude: loc.latitude ?? pt.lat,
            longitude: loc.longitude ?? pt.lon,
            sounding: {
              status: "empty",
              mode: "model",
              model: options.model,
              stationId: null,
              stationName: `${pt.label} · ${formatBoxCoord(pt.lat, pt.lon)}`,
              latitude: loc.latitude ?? pt.lat,
              longitude: loc.longitude ?? pt.lon,
              validTime: null,
              levels: [],
              params: emptyAnalysis.params,
              parcelTraces: emptyAnalysis.parcelTraces,
              attribution: `${meta.label} forecast model via Open-Meteo`,
              message: "No profile at this grid point",
            },
          });
          continue;
        }
        const hi = pickHourIndex(times, options.time);
        const levels = levelsFromHourly(h, hi, BOX_PRESSURE_LEVELS);
        const valid = times[hi]!;
        const validIso = valid.includes("T")
          ? new Date(`${valid}Z`).toISOString()
          : new Date(valid).toISOString();
        if (!validTime) validTime = validIso;
        const analysis = analyzeSounding(levels);
        const lat = loc.latitude ?? pt.lat;
        const lon = loc.longitude ?? pt.lon;
        cells.push({
          row: pt.row,
          col: pt.col,
          label: pt.label,
          latitude: lat,
          longitude: lon,
          sounding: {
            status: levels.length >= 6 ? "ok" : "empty",
            mode: "model",
            model: options.model,
            stationId: null,
            stationName: `${pt.label} · ${formatBoxCoord(lat, lon)}`,
            latitude: lat,
            longitude: lon,
            validTime: validIso,
            levels,
            params: analysis.params,
            parcelTraces: analysis.parcelTraces,
            attribution: `${meta.label} forecast model via Open-Meteo. Guidance only.`,
            message:
              levels.length >= 6 ? undefined : "Profile too shallow at this point",
          },
        });
      }

      const okCount = cells.filter((c) => c.sounding.status === "ok").length;
      return {
        status: okCount > 0 ? "ok" : "empty",
        mode: "box",
        model: options.model,
        centerLatitude: options.latitude,
        centerLongitude: options.longitude,
        spacingDeg,
        placeLabel,
        validTime,
        cells,
        attribution: `${meta.label} forecast model via Open-Meteo. Guidance only.`,
        message:
          okCount > 0
            ? undefined
            : `${meta.label} box soundings unavailable for this point.`,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return emptyBox(options, spacingDeg, placeLabel, meta.label, lastErr);
}

function emptyBox(
  options: {
    latitude: number;
    longitude: number;
    model: SoundingModelId;
  },
  spacingDeg: SoundingBoxSpacingDeg,
  placeLabel: string,
  label: string,
  message: string,
): SoundingBoxPayload {
  const points = buildSoundingBoxPoints(
    options.latitude,
    options.longitude,
    spacingDeg,
  );
  const empty = analyzeSounding([]);
  return {
    status: "empty",
    mode: "box",
    model: options.model,
    centerLatitude: options.latitude,
    centerLongitude: options.longitude,
    spacingDeg,
    placeLabel,
    validTime: null,
    cells: points.map((pt) => ({
      row: pt.row,
      col: pt.col,
      label: pt.label,
      latitude: pt.lat,
      longitude: pt.lon,
      sounding: {
        status: "empty",
        mode: "model",
        model: options.model,
        stationId: null,
        stationName: `${pt.label} · ${formatBoxCoord(pt.lat, pt.lon)}`,
        latitude: pt.lat,
        longitude: pt.lon,
        validTime: null,
        levels: [],
        params: empty.params,
        parcelTraces: empty.parcelTraces,
        attribution: `${label} forecast model via Open-Meteo`,
        message,
      },
    })),
    attribution: `${label} forecast model via Open-Meteo`,
    message,
  };
}

function emptyModel(
  options: {
    latitude: number;
    longitude: number;
    model: SoundingModelId;
    placeLabel?: string;
  },
  label: string,
  message: string,
): SoundingPayload {
  const empty = analyzeSounding([]);
  return {
    status: "empty",
    mode: "model",
    model: options.model,
    stationId: null,
    stationName: options.placeLabel ?? "Selected location",
    latitude: options.latitude,
    longitude: options.longitude,
    validTime: null,
    levels: [],
    params: empty.params,
    parcelTraces: empty.parcelTraces,
    attribution: `${label} forecast model via Open-Meteo`,
    message,
  };
}

export function listModelSoundingHours(days = 3): string[] {
  const out: string[] = [];
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const n = days * 24;
  for (let i = 0; i < n; i++) {
    out.push(new Date(now.getTime() + i * 3_600_000).toISOString());
  }
  return out;
}
