/** Extended climate / ensemble guidance via Open-Meteo (not BoM seasonal). */

export type ClimateDay = {
  date: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  rainMm: number | null;
  rainChancePct: number | null;
};

export type ClimateOutlookPayload = {
  latitude: number;
  longitude: number;
  placeLabel: string;
  days: ClimateDay[];
  summary: {
    avgMaxC: number | null;
    avgMinC: number | null;
    totalRainMm: number | null;
    wetDays: number;
  };
  attribution: string;
  disclaimer: string;
  bomLinks: { label: string; href: string }[];
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function fetchClimateOutlook(options: {
  latitude: number;
  longitude: number;
  placeLabel?: string;
  days?: number;
}): Promise<ClimateOutlookPayload> {
  const {
    latitude,
    longitude,
    placeLabel = "Australia",
    days: daysIn = 16,
  } = options;
  const forecastDays = Math.max(14, Math.min(28, Math.round(daysIn)));

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
    forecast_days: String(Math.min(forecastDays, 16)),
    timezone: "Australia/Sydney",
  });

  // Prefer ensemble mean when available for longer guidance feel.
  const ensembleParams = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    forecast_days: String(Math.min(forecastDays, 35)),
    timezone: "Australia/Sydney",
  });

  let daily: Record<string, unknown[]> = {};
  let source = "Open-Meteo forecast";

  try {
    const ens = await fetch(
      `https://ensemble-api.open-meteo.com/v1/ensemble?${ensembleParams}&models=ecmwf_ifs025`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (ens.ok) {
      const json = (await ens.json()) as { daily?: Record<string, unknown[]> };
      if (json.daily?.time?.length) {
        daily = json.daily;
        source = "Open-Meteo ECMWF ensemble";
      }
    }
  } catch {
    /* fall through */
  }

  if (!daily.time?.length) {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) throw new Error(`Climate outlook unavailable (${res.status})`);
    const json = (await res.json()) as { daily?: Record<string, unknown[]> };
    daily = json.daily || {};
  }

  const times = (daily.time || []).filter(
    (t): t is string => typeof t === "string",
  );
  const sliced = times.slice(0, forecastDays);

  const days: ClimateDay[] = sliced.map((date, i) => {
    // Ensemble APIs often return member arrays — take first member or scalar.
    const maxRaw = daily.temperature_2m_max?.[i];
    const minRaw = daily.temperature_2m_min?.[i];
    const rainRaw = daily.precipitation_sum?.[i];
    const chanceRaw = daily.precipitation_probability_max?.[i];
    const pick = (v: unknown): number | null => {
      if (Array.isArray(v)) return num(v[0]);
      return num(v);
    };
    return {
      date,
      tempMaxC: pick(maxRaw),
      tempMinC: pick(minRaw),
      rainMm: pick(rainRaw),
      rainChancePct: pick(chanceRaw),
    };
  });

  const maxes = days.map((d) => d.tempMaxC).filter((v): v is number => v != null);
  const mins = days.map((d) => d.tempMinC).filter((v): v is number => v != null);
  const rains = days.map((d) => d.rainMm).filter((v): v is number => v != null);
  const wetDays = rains.filter((r) => r >= 1).length;

  return {
    latitude,
    longitude,
    placeLabel,
    days,
    summary: {
      avgMaxC:
        maxes.length > 0
          ? Math.round((maxes.reduce((a, b) => a + b, 0) / maxes.length) * 10) /
            10
          : null,
      avgMinC:
        mins.length > 0
          ? Math.round((mins.reduce((a, b) => a + b, 0) / mins.length) * 10) /
            10
          : null,
      totalRainMm:
        rains.length > 0
          ? Math.round(rains.reduce((a, b) => a + b, 0) * 10) / 10
          : null,
      wetDays,
    },
    attribution: source,
    disclaimer:
      "This is model guidance for planning context only — not an official BoM seasonal climate outlook.",
    bomLinks: [
      {
        label: "BoM climate & past weather",
        href: "https://www.bom.gov.au/climate/",
      },
      {
        label: "BoM seasonal outlooks",
        href: "https://www.bom.gov.au/climate/outlooks/",
      },
      {
        label: "BoM ENSO wrap-up",
        href: "https://www.bom.gov.au/climate/enso/",
      },
    ],
  };
}
