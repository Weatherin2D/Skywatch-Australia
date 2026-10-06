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

/** 1 = national backbone, 2 = regional fill, 3 = local detail */
export type StationTier = 1 | 2 | 3;

export type WeatherStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tier: StationTier;
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

export type StationSite = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tier: StationTier;
};

/**
 * Expanded AU observation network.
 * Tier controls when a site is eligible; spatial declutter still enforces spacing.
 */
export const STATION_SITES: StationSite[] = [
  // Tier 1 — national backbone (always candidates at continent view)
  { id: "perth", name: "Perth", lat: -31.95, lon: 115.86, tier: 1 },
  { id: "darwin", name: "Darwin", lat: -12.46, lon: 130.84, tier: 1 },
  { id: "alice", name: "Alice Springs", lat: -23.7, lon: 133.88, tier: 1 },
  { id: "adelaide", name: "Adelaide", lat: -34.93, lon: 138.6, tier: 1 },
  { id: "melbourne", name: "Melbourne", lat: -37.81, lon: 144.96, tier: 1 },
  { id: "hobart", name: "Hobart", lat: -42.88, lon: 147.33, tier: 1 },
  { id: "canberra", name: "Canberra", lat: -35.28, lon: 149.13, tier: 1 },
  { id: "sydney", name: "Sydney", lat: -33.87, lon: 151.21, tier: 1 },
  { id: "brisbane", name: "Brisbane", lat: -27.47, lon: 153.03, tier: 1 },
  { id: "cairns", name: "Cairns", lat: -16.92, lon: 145.78, tier: 1 },
  { id: "broome", name: "Broome", lat: -17.95, lon: 122.24, tier: 1 },
  { id: "kalgoorlie", name: "Kalgoorlie", lat: -30.75, lon: 121.47, tier: 1 },
  { id: "townsville", name: "Townsville", lat: -19.26, lon: 146.82, tier: 1 },
  { id: "mount-isa", name: "Mount Isa", lat: -20.73, lon: 139.49, tier: 1 },

  // Tier 2 — regional
  { id: "geraldton", name: "Geraldton", lat: -28.78, lon: 114.61, tier: 2 },
  { id: "albany", name: "Albany", lat: -35.03, lon: 117.88, tier: 2 },
  { id: "esperance", name: "Esperance", lat: -33.86, lon: 121.89, tier: 2 },
  { id: "carnarvon", name: "Carnarvon", lat: -24.88, lon: 113.66, tier: 2 },
  { id: "port-hedland", name: "Port Hedland", lat: -20.38, lon: 118.63, tier: 2 },
  { id: "karratha", name: "Karratha", lat: -20.74, lon: 116.85, tier: 2 },
  { id: "kununurra", name: "Kununurra", lat: -15.78, lon: 128.74, tier: 2 },
  { id: "tennant", name: "Tennant Creek", lat: -19.65, lon: 134.18, tier: 2 },
  { id: "gove", name: "Nhulunbuy", lat: -12.19, lon: 136.78, tier: 2 },
  { id: "woomera", name: "Woomera", lat: -31.2, lon: 136.82, tier: 2 },
  { id: "port-lincoln", name: "Port Lincoln", lat: -34.73, lon: 135.86, tier: 2 },
  { id: "mount-gambier", name: "Mt Gambier", lat: -37.83, lon: 140.78, tier: 2 },
  { id: "mildura", name: "Mildura", lat: -34.23, lon: 142.08, tier: 2 },
  { id: "bendigo", name: "Bendigo", lat: -36.76, lon: 144.28, tier: 2 },
  { id: "sale", name: "Sale", lat: -38.11, lon: 147.07, tier: 2 },
  { id: "launceston", name: "Launceston", lat: -41.43, lon: 147.14, tier: 2 },
  { id: "strahan", name: "Strahan", lat: -42.15, lon: 145.33, tier: 2 },
  { id: "wagga", name: "Wagga Wagga", lat: -35.16, lon: 147.46, tier: 2 },
  { id: "dubbo", name: "Dubbo", lat: -32.25, lon: 148.6, tier: 2 },
  { id: "newcastle", name: "Newcastle", lat: -32.93, lon: 151.78, tier: 2 },
  { id: "coffs", name: "Coffs Harbour", lat: -30.3, lon: 153.12, tier: 2 },
  { id: "broken-hill", name: "Broken Hill", lat: -31.96, lon: 141.47, tier: 2 },
  { id: "rockhampton", name: "Rockhampton", lat: -23.38, lon: 150.51, tier: 2 },
  { id: "mackay", name: "Mackay", lat: -21.14, lon: 149.19, tier: 2 },
  { id: "longreach", name: "Longreach", lat: -23.44, lon: 144.25, tier: 2 },
  { id: "charleville", name: "Charleville", lat: -26.41, lon: 146.24, tier: 2 },
  { id: "toowoomba", name: "Toowoomba", lat: -27.56, lon: 151.95, tier: 2 },
  { id: "weipa", name: "Weipa", lat: -12.68, lon: 141.92, tier: 2 },
  { id: "norfolk", name: "Norfolk Island", lat: -29.04, lon: 167.94, tier: 2 },

  // Tier 3 — local fill
  { id: "mandurah", name: "Mandurah", lat: -32.53, lon: 115.72, tier: 3 },
  { id: "northam", name: "Northam", lat: -31.65, lon: 116.67, tier: 3 },
  { id: "meekatharra", name: "Meekatharra", lat: -26.59, lon: 118.5, tier: 3 },
  { id: "learmonth", name: "Learmonth", lat: -22.24, lon: 114.09, tier: 3 },
  { id: "halls-creek", name: "Halls Creek", lat: -18.23, lon: 127.67, tier: 3 },
  { id: "katherine", name: "Katherine", lat: -14.47, lon: 132.26, tier: 3 },
  { id: "yulara", name: "Yulara", lat: -25.24, lon: 130.99, tier: 3 },
  { id: "ceduna", name: "Ceduna", lat: -32.13, lon: 133.68, tier: 3 },
  { id: "whyalla", name: "Whyalla", lat: -33.03, lon: 137.58, tier: 3 },
  { id: "renmark", name: "Renmark", lat: -34.17, lon: 140.75, tier: 3 },
  { id: "ballarat", name: "Ballarat", lat: -37.56, lon: 143.85, tier: 3 },
  { id: "wangaratta", name: "Wangaratta", lat: -36.36, lon: 146.31, tier: 3 },
  { id: "warrnambool", name: "Warrnambool", lat: -38.38, lon: 142.48, tier: 3 },
  { id: "wilson", name: "Wilsons Prom", lat: -39.13, lon: 146.42, tier: 3 },
  { id: "devonport", name: "Devonport", lat: -41.18, lon: 146.35, tier: 3 },
  { id: "queenstown", name: "Queenstown", lat: -42.08, lon: 145.55, tier: 3 },
  { id: "albury", name: "Albury", lat: -36.07, lon: 146.92, tier: 3 },
  { id: "orange", name: "Orange", lat: -33.28, lon: 149.1, tier: 3 },
  { id: "tamworth", name: "Tamworth", lat: -31.09, lon: 150.93, tier: 3 },
  { id: "armidale", name: "Armidale", lat: -30.51, lon: 151.67, tier: 3 },
  { id: "wollongong", name: "Wollongong", lat: -34.42, lon: 150.89, tier: 3 },
  { id: "nowra", name: "Nowra", lat: -34.95, lon: 150.53, tier: 3 },
  { id: "bega", name: "Bega", lat: -36.67, lon: 149.84, tier: 3 },
  { id: "cessnock", name: "Cessnock", lat: -32.83, lon: 151.35, tier: 3 },
  { id: "williamtown", name: "Williamtown", lat: -32.8, lon: 151.84, tier: 3 },
  { id: "lismore", name: "Lismore", lat: -28.81, lon: 153.28, tier: 3 },
  { id: "gold-coast", name: "Gold Coast", lat: -28.02, lon: 153.4, tier: 3 },
  { id: "sunshine-coast", name: "Sunshine Coast", lat: -26.6, lon: 153.09, tier: 3 },
  { id: "bundaberg", name: "Bundaberg", lat: -24.87, lon: 152.35, tier: 3 },
  { id: "gladstone", name: "Gladstone", lat: -23.84, lon: 151.26, tier: 3 },
  { id: "emerald", name: "Emerald", lat: -23.53, lon: 148.16, tier: 3 },
  { id: "roma", name: "Roma", lat: -26.57, lon: 148.79, tier: 3 },
  { id: "thursday", name: "Horn Island", lat: -10.58, lon: 142.29, tier: 3 },
  { id: "cooktown", name: "Cooktown", lat: -15.47, lon: 145.25, tier: 3 },
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

function parseRow(site: StationSite, row: OpenMeteoRow): WeatherStation {
  const cur = row.current ?? {};
  const hourlyP = row.hourly?.pressure_msl ?? [];
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
    tier: site.tier,
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

/** Rough km separation used for declutter (lat-scaled). */
function separationKm(a: WeatherStation, b: WeatherStation): number {
  const dLat = (a.lat - b.lat) * 111;
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLon = (a.lon - b.lon) * 111 * Math.cos(midLat);
  return Math.hypot(dLat, dLon);
}

export type StationDensity = {
  /** Max stations to draw in the current view. */
  maxCount: number;
  /** Minimum km between plotted stations. */
  minSeparationKm: number;
  /** Highest tier eligible (1–3). */
  maxTier: StationTier;
  /** Render scale for the station-model glyph (1 = full). */
  scale: number;
};

/** Leaflet zoom → density. Tuned so national view stays readable. */
export function densityForLeafletZoom(zoom: number): StationDensity {
  if (zoom < 4) {
    return { maxCount: 0, minSeparationKm: 999, maxTier: 1, scale: 0.85 };
  }
  if (zoom < 4.7) {
    // Full Australia — capitals + sparse hubs only
    return { maxCount: 14, minSeparationKm: 400, maxTier: 1, scale: 0.8 };
  }
  if (zoom < 5.4) {
    return { maxCount: 20, minSeparationKm: 280, maxTier: 2, scale: 0.88 };
  }
  if (zoom < 6.2) {
    return { maxCount: 30, minSeparationKm: 160, maxTier: 2, scale: 0.94 };
  }
  if (zoom < 7) {
    return { maxCount: 42, minSeparationKm: 90, maxTier: 3, scale: 1 };
  }
  if (zoom < 8) {
    return { maxCount: 58, minSeparationKm: 50, maxTier: 3, scale: 1 };
  }
  return { maxCount: 72, minSeparationKm: 28, maxTier: 3, scale: 1 };
}

/**
 * Fixed satellite/region crop → density from geographic span.
 * National (~60° lon) is sparse; state crops denser.
 */
export function densityForBounds(bounds: [[number, number], [number, number]]): StationDensity {
  const [[south, west], [north, east]] = bounds;
  const spanLon = Math.abs(east - west);
  const spanLat = Math.abs(north - south);
  const span = Math.max(spanLon, spanLat);
  if (span >= 40) {
    return { maxCount: 14, minSeparationKm: 400, maxTier: 1, scale: 0.78 };
  }
  if (span >= 22) {
    return { maxCount: 18, minSeparationKm: 260, maxTier: 2, scale: 0.88 };
  }
  if (span >= 12) {
    return { maxCount: 28, minSeparationKm: 140, maxTier: 2, scale: 0.94 };
  }
  if (span >= 6) {
    return { maxCount: 40, minSeparationKm: 75, maxTier: 3, scale: 1 };
  }
  return { maxCount: 58, minSeparationKm: 36, maxTier: 3, scale: 1 };
}

/**
 * Greedy declutter: keep the tier-1 backbone (soft spacing so capitals stay),
 * then fill with regional/local sites under full separation.
 */
export function declutterStations(
  stations: WeatherStation[],
  density: StationDensity,
): WeatherStation[] {
  if (density.maxCount <= 0) return [];
  const byName = (a: WeatherStation, b: WeatherStation) =>
    a.name.localeCompare(b.name);

  const eligible = stations.filter((s) => s.tier <= density.maxTier);
  const backbone = eligible.filter((s) => s.tier === 1).sort(byName);
  const fill = eligible.filter((s) => s.tier > 1).sort((a, b) => a.tier - b.tier || byName(a, b));

  const picked: WeatherStation[] = [];
  // Soft spacing among capitals so Sydney / Melbourne / Canberra can coexist
  const backboneSepKm = Math.max(180, density.minSeparationKm * 0.5);
  for (const s of backbone) {
    if (picked.length >= density.maxCount) break;
    if (picked.every((p) => separationKm(p, s) >= backboneSepKm)) {
      picked.push(s);
    }
  }
  for (const s of fill) {
    if (picked.length >= density.maxCount) break;
    if (picked.every((p) => separationKm(p, s) >= density.minSeparationKm)) {
      picked.push(s);
    }
  }
  return picked;
}

export async function fetchLiveStations(
  signal?: AbortSignal,
): Promise<StationsPayload> {
  // Open-Meteo caps URL length; batch in chunks of 40.
  const chunkSize = 40;
  const stations: WeatherStation[] = [];

  for (let start = 0; start < STATION_SITES.length; start += chunkSize) {
    const chunk = STATION_SITES.slice(start, start + chunkSize);
    const lats = chunk.map((s) => s.lat.toFixed(4)).join(",");
    const lons = chunk.map((s) => s.lon.toFixed(4)).join(",");
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
    for (let i = 0; i < chunk.length; i++) {
      stations.push(parseRow(chunk[i]!, rows[i] ?? {}));
    }
  }

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
