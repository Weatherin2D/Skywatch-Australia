/**
 * Model Skew-T profiles from Open-Meteo pressure levels.
 */

import type {
  SoundingLevel,
  SoundingModelId,
  SoundingPayload,
} from "@/lib/weather/sounding-types";
import { analyzeSounding } from "@/lib/weather/sounding-thermo";

const PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 700, 650, 600, 550,
  500, 450, 400, 350, 300, 250, 200, 150, 100,
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

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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

export async function fetchModelSounding(options: {
  latitude: number;
  longitude: number;
  model: SoundingModelId;
  placeLabel?: string;
  time?: string | null;
}): Promise<SoundingPayload> {
  const meta = MODEL_OPEN_METEO[options.model];
  const hourly: string[] = [];
  for (const p of PRESSURE_LEVELS) {
    hourly.push(
      `temperature_${p}hPa`,
      `dew_point_${p}hPa`,
      `relative_humidity_${p}hPa`,
      `wind_speed_${p}hPa`,
      `wind_direction_${p}hPa`,
      `geopotential_height_${p}hPa`,
    );
  }

  const params = new URLSearchParams({
    latitude: options.latitude.toFixed(4),
    longitude: options.longitude.toFixed(4),
    hourly: hourly.join(","),
    models: meta.models,
    forecast_days: "3",
    timezone: "UTC",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;

  let lastErr = "Open-Meteo failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(40_000),
      });
      if (res.status === 429) {
        lastErr = "Open-Meteo rate limited";
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
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
      const levels: SoundingLevel[] = [];
      for (const p of PRESSURE_LEVELS) {
        const t = num(h[`temperature_${p}hPa`]?.[hi]);
        const td = num(h[`dew_point_${p}hPa`]?.[hi]);
        if (t == null || td == null) continue;
        const z =
          num(h[`geopotential_height_${p}hPa`]?.[hi]) ?? approxHeightM(p);
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
      return {
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
        attribution: `SkyWatch ${meta.label} via Open-Meteo pressure levels. Guidance only.`,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return emptyModel(options, meta.label, lastErr);
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
    attribution: `SkyWatch ${label} via Open-Meteo`,
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
