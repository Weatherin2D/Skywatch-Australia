/**
 * Vertical cross-section along a lat/lon transect from Open-Meteo pressure levels.
 */

import { resolveMapModel, type MapModelId } from "@/lib/weather/ecmwf-map";

const LEVELS = [1000, 925, 850, 700, 500, 300, 250, 200] as const;
const MAX_COLUMNS = 12;

export type CrossSectionField = "temperature" | "rh" | "wind";

export type CrossSectionColumn = {
  lat: number;
  lon: number;
  distanceKm: number;
  values: (number | null)[];
};

export type CrossSectionPayload = {
  field: CrossSectionField;
  units: string;
  model: MapModelId;
  modelLabel: string;
  time: string | null;
  pressures: number[];
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  columns: CrossSectionColumn[];
  min: number | null;
  max: number | null;
  attribution: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function interpolatePoints(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  n: number,
): { lat: number; lon: number; distanceKm: number }[] {
  const count = Math.max(2, Math.min(MAX_COLUMNS, n));
  const total = haversineKm(start.lat, start.lon, end.lat, end.lon);
  const out: { lat: number; lon: number; distanceKm: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    out.push({
      lat: start.lat + (end.lat - start.lat) * t,
      lon: start.lon + (end.lon - start.lon) * t,
      distanceKm: total * t,
    });
  }
  return out;
}

function fieldVars(field: CrossSectionField): {
  units: string;
  hourly: string[];
  read: (
    hourly: Record<string, unknown[]>,
    ti: number,
    p: number,
  ) => number | null;
} {
  if (field === "rh") {
    return {
      units: "%",
      hourly: LEVELS.map((p) => `relative_humidity_${p}hPa`),
      read: (h, ti, p) => num(h[`relative_humidity_${p}hPa`]?.[ti]),
    };
  }
  if (field === "wind") {
    return {
      units: "km/h",
      hourly: LEVELS.map((p) => `wind_speed_${p}hPa`),
      read: (h, ti, p) => num(h[`wind_speed_${p}hPa`]?.[ti]),
    };
  }
  return {
    units: "°C",
    hourly: LEVELS.map((p) => `temperature_${p}hPa`),
    read: (h, ti, p) => num(h[`temperature_${p}hPa`]?.[ti]),
  };
}

function nearestTimeIndex(times: string[], preferIso?: string | null): number {
  if (!times.length) return 0;
  const target = preferIso ? Date.parse(preferIso) : Date.now();
  if (!Number.isFinite(target)) return 0;
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

function modelMeta(id: MapModelId): { openMeteo: string; label: string } {
  if (id === "icon") return { openMeteo: "icon_seamless", label: "ICON" };
  if (id === "gfs") return { openMeteo: "gfs_seamless", label: "GFS" };
  return { openMeteo: "ecmwf_ifs", label: "ECMWF" };
}

export async function fetchCrossSection(options: {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  field?: string | null;
  model?: string | null;
  time?: string | null;
  columns?: number;
}): Promise<CrossSectionPayload> {
  const start = { lat: options.startLat, lon: options.startLon };
  const end = { lat: options.endLat, lon: options.endLon };
  for (const v of [start.lat, start.lon, end.lat, end.lon]) {
    if (!Number.isFinite(v)) throw new Error("Invalid transect coordinates");
  }

  const field: CrossSectionField =
    options.field === "rh" || options.field === "humidity"
      ? "rh"
      : options.field === "wind"
        ? "wind"
        : "temperature";
  const model = resolveMapModel(options.model);
  const meta = modelMeta(model);
  const spec = fieldVars(field);
  const points = interpolatePoints(start, end, options.columns ?? 10);

  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    hourly: spec.hourly.join(","),
    models: meta.openMeteo,
    forecast_days: "3",
    timezone: "Australia/Sydney",
    wind_speed_unit: "kmh",
    cell_selection: "nearest",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  let lastErr = "Open-Meteo failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429) {
        lastErr = "Open-Meteo rate limited";
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const json = (await res.json()) as
        | {
            latitude?: number;
            longitude?: number;
            hourly?: Record<string, unknown[]>;
          }
        | Array<{
            latitude?: number;
            longitude?: number;
            hourly?: Record<string, unknown[]>;
          }>;
      const locs = Array.isArray(json) ? json : [json];
      let times: string[] = [];
      for (const loc of locs) {
        const t = (loc.hourly?.time ?? []) as unknown[];
        if (t.length) {
          times = t.map(String);
          break;
        }
      }
      if (!times.length) throw new Error("No hourly times for cross-section");
      const ti = nearestTimeIndex(times, options.time);

      const columns: CrossSectionColumn[] = points.map((pt, i) => {
        const loc = locs[i] ?? locs[0];
        const hourly = loc?.hourly ?? {};
        const values = LEVELS.map((p) => spec.read(hourly, ti, p));
        return {
          lat: pt.lat,
          lon: pt.lon,
          distanceKm: Math.round(pt.distanceKm * 10) / 10,
          values,
        };
      });

      const flat = columns.flatMap((c) =>
        c.values.filter((v): v is number => v != null),
      );
      return {
        field,
        units: spec.units,
        model,
        modelLabel: meta.label,
        time: times[ti] ?? null,
        pressures: [...LEVELS],
        start,
        end,
        columns,
        min: flat.length ? Math.min(...flat) : null,
        max: flat.length ? Math.max(...flat) : null,
        attribution: `${meta.label} pressure-level cross-section via Open-Meteo. Guidance only.`,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastErr);
}
