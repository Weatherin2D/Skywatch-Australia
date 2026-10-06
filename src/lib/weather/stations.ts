/**
 * Live Australian weather-station observations for map station-model overlays.
 * Data via Open-Meteo current + short hourly (pressure tendency).
 */

export type PresentWeather =
  | "clear"
  | "rain-light"
  | "rain-mod"
  | "rain-heavy"
  | "rain-shower"
  | "snow-light"
  | "snow-mod"
  | "snow-heavy"
  | "snow-shower"
  | "ice-pellets"
  | "fog"
  | "thunderstorm";

export type PressureTendency =
  | "rising"
  | "falling"
  | "steady"
  | "rising-then-falling"
  | "falling-then-rising"
  | "rising-then-steady"
  | "falling-then-steady";

export type WeatherStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Air temperature °C */
  temperatureC: number | null;
  /** Dew point °C */
  dewpointC: number | null;
  /** MSL pressure hPa */
  pressureHpa: number | null;
  /** 3-hour pressure change in tenths of hPa (e.g. -11 = −1.1 hPa) */
  pressureChangeTenths: number | null;
  pressureTendency: PressureTendency | null;
  /** Wind from direction, degrees */
  windDirDeg: number | null;
  /** Wind speed km/h */
  windSpeedKmh: number | null;
  /** Total cloud cover 0–100 */
  cloudCoverPct: number | null;
  presentWeather: PresentWeather;
  observedAt: string | null;
};

export type StationsPayload = {
  stations: WeatherStation[];
  updatedAt: string;
  attribution: string;
};

/** Curated national network — dense enough to read, sparse enough to stay clear. */
export const STATION_SITES: {
  id: string;
  name: string;
  lat: number;
  lon: number;
}[] = [
  { id: "perth", name: "Perth", lat: -31.95, lon: 115.86 },
  { id: "geraldton", name: "Geraldton", lat: -28.78, lon: 114.61 },
  { id: "kalgoorlie", name: "Kalgoorlie", lat: -30.75, lon: 121.47 },
  { id: "broome", name: "Broome", lat: -17.95, lon: 122.24 },
  { id: "port-hedland", name: "Port Hedland", lat: -20.38, lon: 118.63 },
  { id: "darwin", name: "Darwin", lat: -12.46, lon: 130.84 },
  { id: "alice", name: "Alice Springs", lat: -23.7, lon: 133.88 },
  { id: "adelaide", name: "Adelaide", lat: -34.93, lon: 138.6 },
  { id: "woomera", name: "Woomera", lat: -31.2, lon: 136.82 },
  { id: "melbourne", name: "Melbourne", lat: -37.81, lon: 144.96 },
  { id: "mildura", name: "Mildura", lat: -34.23, lon: 142.08 },
  { id: "hobart", name: "Hobart", lat: -42.88, lon: 147.33 },
  { id: "launceston", name: "Launceston", lat: -41.43, lon: 147.14 },
  { id: "canberra", name: "Canberra", lat: -35.28, lon: 149.13 },
  { id: "sydney", name: "Sydney", lat: -33.87, lon: 151.21 },
  { id: "newcastle", name: "Newcastle", lat: -32.93, lon: 151.78 },
  { id: "wagga", name: "Wagga Wagga", lat: -35.16, lon: 147.46 },
  { id: "brisbane", name: "Brisbane", lat: -27.47, lon: 153.03 },
  { id: "cairns", name: "Cairns", lat: -16.92, lon: 145.78 },
  { id: "townsville", name: "Townsville", lat: -19.26, lon: 146.82 },
  { id: "rockhampton", name: "Rockhampton", lat: -23.38, lon: 150.51 },
  { id: "mount-isa", name: "Mount Isa", lat: -20.73, lon: 139.49 },
  { id: "longreach", name: "Longreach", lat: -23.44, lon: 144.25 },
  { id: "dubbo", name: "Dubbo", lat: -32.25, lon: 148.6 },
  { id: "cessnock", name: "Cessnock", lat: -32.83, lon: 151.35 },
];

/** Station-model pressure: last 3 digits of tenths of hPa (1019.5 → "195"). */
export function formatStationPressure(hpa: number | null): string {
  if (hpa == null || !Number.isFinite(hpa)) return "";
  const tenths = Math.round(hpa * 10);
  return String(tenths % 1000).padStart(3, "0");
}

export function formatStationTemp(c: number | null): string {
  if (c == null || !Number.isFinite(c)) return "";
  return String(Math.round(c));
}

/** Map Open-Meteo WMO weather code → present-weather class for the plot. */
export function weatherCodeToPresent(code: number | null): PresentWeather {
  if (code == null || !Number.isFinite(code)) return "clear";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "thunderstorm";
  if (code === 56 || code === 57 || code === 66 || code === 67) return "ice-pellets";
  if (code === 71 || code === 85) return "snow-light";
  if (code === 73) return "snow-mod";
  if (code === 75 || code === 77 || code === 86) return "snow-heavy";
  if (code === 80 || code === 81 || code === 82) return "rain-shower";
  if (code === 51 || code === 61) return "rain-light";
  if (code === 53 || code === 63) return "rain-mod";
  if (code === 55 || code === 65) return "rain-heavy";
  return "clear";
}

function tendencyFromSeries(
  nowHpa: number | null,
  series: (number | null)[],
): { changeTenths: number | null; tendency: PressureTendency | null } {
  if (nowHpa == null || !Number.isFinite(nowHpa)) {
    return { changeTenths: null, tendency: null };
  }
  const past = [...series].reverse().find((v) => v != null && Number.isFinite(v));
  if (past == null) return { changeTenths: null, tendency: "steady" };
  const delta = nowHpa - past;
  const changeTenths = Math.round(delta * 10);
  if (Math.abs(delta) < 0.15) return { changeTenths, tendency: "steady" };
  if (delta > 0) return { changeTenths, tendency: "rising" };
  return { changeTenths, tendency: "falling" };
}

type OpenMeteoCurrent = {
  time?: string;
  temperature_2m?: number;
  dewpoint_2m?: number;
  weather_code?: number;
  cloud_cover?: number;
  pressure_msl?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
};

type OpenMeteoRow = {
  latitude?: number;
  longitude?: number;
  current?: OpenMeteoCurrent;
  hourly?: {
    time?: string[];
    pressure_msl?: (number | null)[];
  };
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseRow(site: (typeof STATION_SITES)[number], row: OpenMeteoRow): WeatherStation {
  const cur = row.current ?? {};
  const hourlyP = row.hourly?.pressure_msl ?? [];
  // Open-Meteo with past_hours=3 returns ~4 pressure points ending at "now".
  const pastWindow = hourlyP.slice(0, Math.max(0, hourlyP.length - 1));
  const { changeTenths, tendency } = tendencyFromSeries(
    num(cur.pressure_msl),
    pastWindow,
  );
  return {
    id: site.id,
    name: site.name,
    lat: site.lat,
    lon: site.lon,
    temperatureC: num(cur.temperature_2m),
    dewpointC: num(cur.dewpoint_2m),
    pressureHpa: num(cur.pressure_msl),
    pressureChangeTenths: changeTenths,
    pressureTendency: tendency,
    windDirDeg: num(cur.wind_direction_10m),
    windSpeedKmh: num(cur.wind_speed_10m),
    cloudCoverPct: num(cur.cloud_cover),
    presentWeather: weatherCodeToPresent(num(cur.weather_code)),
    observedAt: typeof cur.time === "string" ? cur.time : null,
  };
}

export async function fetchLiveStations(
  signal?: AbortSignal,
): Promise<StationsPayload> {
  const lats = STATION_SITES.map((s) => s.lat.toFixed(4)).join(",");
  const lons = STATION_SITES.map((s) => s.lon.toFixed(4)).join(",");
  const params = new URLSearchParams({
    latitude: lats,
    longitude: lons,
    current: [
      "temperature_2m",
      "dewpoint_2m",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
    ].join(","),
    hourly: "pressure_msl",
    past_hours: "3",
    forecast_hours: "1",
    wind_speed_unit: "kmh",
    timezone: "Australia/Sydney",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo stations unavailable (${res.status})`);
  }
  const json = (await res.json()) as OpenMeteoRow | OpenMeteoRow[];
  const rows = Array.isArray(json) ? json : [json];
  const stations = STATION_SITES.map((site, i) =>
    parseRow(site, rows[i] ?? {}),
  );
  return {
    stations,
    updatedAt: new Date().toISOString(),
    attribution: "Open-Meteo",
  };
}

let cache: { at: number; payload: StationsPayload } | null = null;
const CACHE_MS = 2 * 60_000;

export async function getLiveStationsCached(
  signal?: AbortSignal,
): Promise<StationsPayload> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.payload;
  const payload = await fetchLiveStations(signal);
  cache = { at: Date.now(), payload };
  return payload;
}
