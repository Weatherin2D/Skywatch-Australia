/**
 * Open-Meteo ensemble member traces for 2 m temp / precip at a place.
 */

export type EnsembleVariable = "temperature_2m" | "precipitation";

export type EnsembleMemberTrace = {
  id: string;
  label: string;
  values: (number | null)[];
};

export type EnsembleSpaghettiPayload = {
  latitude: number;
  longitude: number;
  placeLabel: string;
  variable: EnsembleVariable;
  units: string;
  model: string;
  times: string[];
  members: EnsembleMemberTrace[];
  mean: (number | null)[];
  attribution: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickSeries(
  hourly: Record<string, unknown[]>,
  key: string,
): (number | null)[] | null {
  const raw = hourly[key];
  if (!Array.isArray(raw) || !raw.length) return null;
  // Some payloads nest member arrays per timestep.
  if (Array.isArray(raw[0])) {
    return null;
  }
  return raw.map(num);
}

function collectMembers(
  hourly: Record<string, unknown[]>,
  variable: EnsembleVariable,
  nTimes: number,
): EnsembleMemberTrace[] {
  const members: EnsembleMemberTrace[] = [];
  const re = new RegExp(`^${variable}_member(\\d+)$`, "i");
  for (const key of Object.keys(hourly)) {
    const m = key.match(re);
    if (!m) continue;
    const series = pickSeries(hourly, key);
    if (!series) continue;
    const padded = Array.from({ length: nTimes }, (_, i) => series[i] ?? null);
    members.push({
      id: `m${m[1]}`,
      label: `M${Number(m[1])}`,
      values: padded,
    });
  }
  members.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return members;
}

function meanOf(members: EnsembleMemberTrace[], nTimes: number): (number | null)[] {
  return Array.from({ length: nTimes }, (_, ti) => {
    let sum = 0;
    let n = 0;
    for (const m of members) {
      const v = m.values[ti];
      if (v == null) continue;
      sum += v;
      n++;
    }
    return n ? sum / n : null;
  });
}

export async function fetchEnsembleSpaghetti(options: {
  latitude: number;
  longitude: number;
  placeLabel?: string;
  variable?: EnsembleVariable | string | null;
  forecastDays?: number;
}): Promise<EnsembleSpaghettiPayload> {
  const latitude = options.latitude;
  const longitude = options.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Invalid coordinates");
  }
  const variable: EnsembleVariable =
    options.variable === "precipitation" ? "precipitation" : "temperature_2m";
  const forecastDays = Math.max(1, Math.min(10, options.forecastDays ?? 7));

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: variable,
    forecast_days: String(forecastDays),
    timezone: "Australia/Sydney",
  });

  const url = `https://ensemble-api.open-meteo.com/v1/ensemble?${params}&models=ecmwf_ifs025`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Ensemble API ${res.status}`);
  const json = (await res.json()) as {
    hourly?: Record<string, unknown[]>;
    hourly_units?: Record<string, string>;
  };
  const hourly = json.hourly ?? {};
  const times = ((hourly.time ?? []) as unknown[]).map(String);
  if (!times.length) {
    throw new Error("Ensemble returned no hourly times");
  }

  let members = collectMembers(hourly, variable, times.length);

  // Fallback: control/mean series only when members missing.
  if (!members.length) {
    const control = pickSeries(hourly, variable);
    if (control) {
      members = [
        {
          id: "control",
          label: "Control",
          values: Array.from(
            { length: times.length },
            (_, i) => control[i] ?? null,
          ),
        },
      ];
    }
  }

  const meanSeries = pickSeries(hourly, variable);
  const mean =
    meanSeries && meanSeries.some((v) => v != null)
      ? Array.from({ length: times.length }, (_, i) => meanSeries[i] ?? null)
      : meanOf(members, times.length);

  const units =
    json.hourly_units?.[variable] ??
    (variable === "precipitation" ? "mm" : "°C");

  return {
    latitude,
    longitude,
    placeLabel: options.placeLabel ?? "Selected place",
    variable,
    units,
    model: "ecmwf_ifs025",
    times,
    members,
    mean,
    attribution:
      "Open-Meteo ECMWF IFS ensemble (0.25°) — member spaghetti, guidance only.",
  };
}
