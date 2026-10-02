/** Open-Meteo multi-model comparison for a location. */

export type ModelId = "ecmwf" | "icon" | "gfs";

export type ModelDayMetrics = {
  maxTempC: number | null;
  minTempC: number | null;
  rainMm: number | null;
  rainChancePct: number | null;
  windMaxKmh: number | null;
};

export type ModelDaySlice = {
  date: string;
  models: Record<ModelId, { label: string; metrics: ModelDayMetrics }>;
  rows: {
    metric: string;
    ecmwf: string;
    icon: string;
    gfs: string;
  }[];
};

export type ModelComparisonPayload = {
  latitude: number;
  longitude: number;
  placeLabel: string;
  /** First day (compat with home panel). */
  date: string | null;
  models: Record<ModelId, { label: string; metrics: ModelDayMetrics }>;
  rows: ModelDaySlice["rows"];
  /** Multi-day slices (1–7). */
  days: ModelDaySlice[];
  attribution: string;
};

const MODEL_KEYS: { id: ModelId; label: string; suffix: string }[] = [
  { id: "ecmwf", label: "ECMWF", suffix: "ecmwf_ifs025" },
  { id: "icon", label: "ICON", suffix: "icon_seamless" },
  { id: "gfs", label: "GFS", suffix: "gfs_seamless" },
];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtTemp(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}°`;
}

function fmtRain(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 10) / 10} mm`;
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function fmtWind(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}`;
}

function buildRows(
  models: Record<ModelId, { label: string; metrics: ModelDayMetrics }>,
): ModelDaySlice["rows"] {
  return [
    {
      metric: "Max Temp",
      ecmwf: fmtTemp(models.ecmwf.metrics.maxTempC),
      icon: fmtTemp(models.icon.metrics.maxTempC),
      gfs: fmtTemp(models.gfs.metrics.maxTempC),
    },
    {
      metric: "Min Temp",
      ecmwf: fmtTemp(models.ecmwf.metrics.minTempC),
      icon: fmtTemp(models.icon.metrics.minTempC),
      gfs: fmtTemp(models.gfs.metrics.minTempC),
    },
    {
      metric: "Rain",
      ecmwf: fmtRain(models.ecmwf.metrics.rainMm),
      icon: fmtRain(models.icon.metrics.rainMm),
      gfs: fmtRain(models.gfs.metrics.rainMm),
    },
    {
      metric: "Rain chance",
      ecmwf: fmtPct(models.ecmwf.metrics.rainChancePct),
      icon: fmtPct(models.icon.metrics.rainChancePct),
      gfs: fmtPct(models.gfs.metrics.rainChancePct),
    },
    {
      metric: "Wind (km/h)",
      ecmwf: fmtWind(models.ecmwf.metrics.windMaxKmh),
      icon: fmtWind(models.icon.metrics.windMaxKmh),
      gfs: fmtWind(models.gfs.metrics.windMaxKmh),
    },
  ];
}

function metricsAt(
  daily: Record<string, unknown[]>,
  index: number,
  suffix: string,
): ModelDayMetrics {
  return {
    maxTempC: num(daily[`temperature_2m_max_${suffix}`]?.[index]),
    minTempC: num(daily[`temperature_2m_min_${suffix}`]?.[index]),
    rainMm: num(daily[`precipitation_sum_${suffix}`]?.[index]),
    rainChancePct: num(
      daily[`precipitation_probability_max_${suffix}`]?.[index],
    ),
    windMaxKmh: num(daily[`wind_speed_10m_max_${suffix}`]?.[index]),
  };
}

export async function fetchModelComparison(options: {
  latitude: number;
  longitude: number;
  placeLabel?: string;
  days?: number;
}): Promise<ModelComparisonPayload> {
  const {
    latitude,
    longitude,
    placeLabel = "Sydney",
    days: daysIn = 1,
  } = options;
  const forecastDays = Math.max(1, Math.min(7, Math.round(daysIn)));

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
    forecast_days: String(forecastDays),
    timezone: "Australia/Sydney",
    models: "ecmwf_ifs025,icon_seamless,gfs_seamless",
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Model comparison unavailable (${res.status})`);
  const json = (await res.json()) as {
    daily?: Record<string, unknown[]>;
  };
  const daily = json.daily || {};
  const times = (daily.time || []).filter(
    (t): t is string => typeof t === "string",
  );

  const daySlices: ModelDaySlice[] = times.map((date, index) => {
    const models = {} as ModelDaySlice["models"];
    for (const m of MODEL_KEYS) {
      models[m.id] = {
        label: m.label,
        metrics: metricsAt(daily, index, m.suffix),
      };
    }
    return { date, models, rows: buildRows(models) };
  });

  const first = daySlices[0] ?? {
    date: null as unknown as string,
    models: {
      ecmwf: { label: "ECMWF", metrics: metricsAt(daily, 0, "ecmwf_ifs025") },
      icon: { label: "ICON", metrics: metricsAt(daily, 0, "icon_seamless") },
      gfs: { label: "GFS", metrics: metricsAt(daily, 0, "gfs_seamless") },
    },
    rows: [],
  };

  if (!daySlices.length) {
    first.rows = buildRows(first.models);
  }

  return {
    latitude,
    longitude,
    placeLabel,
    date: daySlices[0]?.date ?? null,
    models: first.models,
    rows: first.rows.length ? first.rows : buildRows(first.models),
    days: daySlices,
    attribution: "Open-Meteo · ECMWF IFS · DWD ICON · NCEP GFS",
  };
}
