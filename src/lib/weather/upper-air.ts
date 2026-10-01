/** Upper-air / convective profile from Open-Meteo pressure levels. */

export type UpperAirPayload = {
  latitude: number;
  longitude: number;
  placeLabel: string;
  validTime: string | null;
  cape: number | null;
  cin: number | null;
  shearKmh: number | null;
  height500m: number | null;
  temp850C: number | null;
  temp500C: number | null;
  rh850Pct: number | null;
  /** Coarse temp profile for sparkline (top of atmosphere → surface). */
  profile: { label: string; tempC: number | null }[];
  attribution: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickNearestHour(times: string[]): number {
  if (!times.length) return 0;
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]!);
    if (!Number.isFinite(t)) continue;
    const diff = Math.abs(t - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

export async function fetchUpperAir(options: {
  latitude: number;
  longitude: number;
  placeLabel?: string;
}): Promise<UpperAirPayload> {
  const { latitude, longitude, placeLabel = "Sydney" } = options;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: [
      "temperature_1000hPa",
      "temperature_850hPa",
      "temperature_700hPa",
      "temperature_500hPa",
      "temperature_300hPa",
      "geopotential_height_500hPa",
      "relative_humidity_850hPa",
      "wind_speed_850hPa",
      "wind_speed_500hPa",
      "cape",
      "convective_inhibition",
    ].join(","),
    forecast_days: "1",
    timezone: "Australia/Sydney",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  let lastErr: Error | null = null;
  let json: { hourly?: Record<string, unknown[]> } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(18_000),
      });
      if (res.status === 429) {
        lastErr = new Error("Open-Meteo 429");
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Upper air unavailable (${res.status})`);
      json = (await res.json()) as { hourly?: Record<string, unknown[]> };
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (!json) throw lastErr || new Error("Upper air unavailable");

  const h = json.hourly || {};
  const times = (h.time || []).map(String);
  const i = pickNearestHour(times);

  const wind850 = num(h.wind_speed_850hPa?.[i]);
  const wind500 = num(h.wind_speed_500hPa?.[i]);
  const shear =
    wind850 != null && wind500 != null ? Math.abs(wind500 - wind850) : null;

  const profile = [
    { label: "300", tempC: num(h.temperature_300hPa?.[i]) },
    { label: "500", tempC: num(h.temperature_500hPa?.[i]) },
    { label: "700", tempC: num(h.temperature_700hPa?.[i]) },
    { label: "850", tempC: num(h.temperature_850hPa?.[i]) },
    { label: "1000", tempC: num(h.temperature_1000hPa?.[i]) },
  ];

  return {
    latitude,
    longitude,
    placeLabel,
    validTime: times[i] ?? null,
    cape: num(h.cape?.[i]),
    cin: num(h.convective_inhibition?.[i]),
    shearKmh: shear,
    height500m: num(h.geopotential_height_500hPa?.[i]),
    temp850C: num(h.temperature_850hPa?.[i]),
    temp500C: num(h.temperature_500hPa?.[i]),
    rh850Pct: num(h.relative_humidity_850hPa?.[i]),
    profile,
    attribution: "Open-Meteo pressure-level forecast",
  };
}
