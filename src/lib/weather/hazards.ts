/** UV / fire / marine hazard snapshot for a place. */

import {
  fetchLocationForecast,
  type LocationForecastPayload,
} from "@/lib/weather/location-forecast";

export type MarineSnapshot = {
  waveHeightM: number | null;
  swellHeightM: number | null;
  swellPeriodS: number | null;
  swellDirectionDeg: number | null;
  windWaveHeightM: number | null;
  windKmh: number | null;
  windDirDeg: number | null;
  available: boolean;
  attribution: string;
};

export type HazardsPayload = {
  location: LocationForecastPayload["location"];
  uv: {
    todayIndex: number | null;
    todayCategory: string | null;
    hourly: { time: string; uv: number | null }[];
  };
  fire: {
    rating: string | null;
    colour: string | null;
    /** Open-Meteo fire weather index when BoM text missing. */
    fwi: number | null;
    guidance: boolean;
    note: string;
  };
  marine: MarineSnapshot;
  attribution: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchMarine(
  lat: number,
  lon: number,
): Promise<MarineSnapshot> {
  const empty: MarineSnapshot = {
    waveHeightM: null,
    swellHeightM: null,
    swellPeriodS: null,
    swellDirectionDeg: null,
    windWaveHeightM: null,
    windKmh: null,
    windDirDeg: null,
    available: false,
    attribution: "Open-Meteo Marine",
  };
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly:
        "wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_speed_10m,wind_direction_10m",
      forecast_days: "1",
      timezone: "Australia/Sydney",
    });
    const res = await fetch(
      `https://marine-api.open-meteo.com/v1/marine?${params}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      hourly?: Record<string, unknown[]>;
    };
    const h = json.hourly || {};
    // Pick nearest hour to now (index 0 is usually current/next).
    const i = 0;
    return {
      waveHeightM: num(h.wave_height?.[i]),
      swellHeightM: num(h.swell_wave_height?.[i]),
      swellPeriodS: num(h.swell_wave_period?.[i]),
      swellDirectionDeg: num(h.swell_wave_direction?.[i]),
      windWaveHeightM: num(h.wind_wave_height?.[i]),
      windKmh: num(h.wind_speed_10m?.[i]),
      windDirDeg: num(h.wind_direction_10m?.[i]),
      available:
        num(h.wave_height?.[i]) != null || num(h.swell_wave_height?.[i]) != null,
      attribution: "Open-Meteo Marine",
    };
  } catch {
    return empty;
  }
}

async function fetchFireIndex(
  lat: number,
  lon: number,
): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      daily: "fire_weather_index",
      forecast_days: "1",
      timezone: "Australia/Sydney",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      daily?: { fire_weather_index?: unknown[] };
    };
    return num(json.daily?.fire_weather_index?.[0]);
  } catch {
    return null;
  }
}

export async function fetchHazards(options: {
  geohash: string;
  latitude?: number;
  longitude?: number;
}): Promise<HazardsPayload> {
  const forecast = await fetchLocationForecast(options.geohash);
  if (!forecast) {
    throw new Error("No BoM forecast for this location");
  }
  const lat = options.latitude ?? forecast.location.latitude;
  const lon = options.longitude ?? forecast.location.longitude;
  if (lat == null || lon == null) {
    throw new Error("Location coordinates unavailable");
  }

  const today = forecast.daily[0];
  const [marine, fwi] = await Promise.all([
    fetchMarine(lat, lon),
    fetchFireIndex(lat, lon),
  ]);

  const bomFire = today?.fireDanger || null;
  const hasBomFire = Boolean(bomFire);

  return {
    location: forecast.location,
    uv: {
      todayIndex: today?.uvMaxIndex ?? null,
      todayCategory: today?.uvCategory ?? null,
      hourly: forecast.hourly.slice(0, 24).map((h) => ({
        time: h.time,
        uv: h.uv,
      })),
    },
    fire: {
      rating: bomFire,
      colour: today?.fireDangerColour ?? null,
      fwi: hasBomFire ? null : fwi,
      guidance: !hasBomFire && fwi != null,
      note: hasBomFire
        ? "BoM fire danger rating for today."
        : fwi != null
          ? "Open-Meteo fire weather index guidance — check your state fire service for official ratings."
          : "No fire danger rating available for this location right now.",
    },
    marine,
    attribution: `${forecast.attribution} · Open-Meteo`,
  };
}
