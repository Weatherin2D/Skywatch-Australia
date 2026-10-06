/** Real map overlays — only layers with working data sources. */
export const WEATHER_LAYERS = [
  { id: "lightning", label: "Lightning tracker" },
  { id: "synoptic", label: "Synoptic MSLP" },
  { id: "radar", label: "Rain radar" },
  { id: "stations", label: "Weather stations" },
] as const;

export type LayerId = (typeof WEATHER_LAYERS)[number]["id"];

export const DEFAULT_WEATHER_LAYERS: Record<LayerId, boolean> = {
  lightning: true,
  synoptic: false,
  radar: false,
  stations: false,
};

/** Cartographic toggles for the national map (below weather overlays). */
export const MAP_SETTINGS = [
  { id: "satelliteBasemap", label: "Satellite imagery" },
  { id: "lightningBolts", label: "Lightning bolt icons" },
  { id: "stationColorValues", label: "Colour station values" },
  { id: "cityLabels", label: "City labels" },
  { id: "townLabels", label: "Town labels (dense)" },
  { id: "stateOutlines", label: "State outlines" },
  { id: "stateLabels", label: "State labels" },
  { id: "outlines", label: "Outlines" },
  { id: "oceanNames", label: "Ocean names" },
] as const;

export type MapSettingId = (typeof MAP_SETTINGS)[number]["id"];

export type MapSettingsState = Record<MapSettingId, boolean>;

export const DEFAULT_MAP_SETTINGS: MapSettingsState = {
  /** Esri World Imagery under the open Map (pan/zoom) */
  satelliteBasemap: false,
  /** Bolt glyphs instead of crosshair markers */
  lightningBolts: false,
  /** Thermal / pressure colour coding on station-model numbers */
  stationColorValues: false,
  cityLabels: false,
  /** Hundreds of regional towns (decluttered by zoom / region) */
  townLabels: false,
  stateOutlines: false,
  stateLabels: false,
  /** Australia coastline is on by default */
  outlines: true,
  oceanNames: false,
};

/** Primary map view — not the same as overlay layers. */
export const MAP_MODES = ["Map", "Satellite"] as const;

export type MapMode = (typeof MAP_MODES)[number];

/** Leaflet / GIBS crop bounds as [[south, west], [north, east]]. */
export type RegionBounds = [[number, number], [number, number]];

/**
 * Map region focus. National = full AU frame; states zoom Map + Satellite
 * into that area (satellite requests a tighter higher-res crop).
 */
export const MAP_REGIONS = [
  {
    id: "national",
    label: "National",
    short: "AU",
    bounds: [
      [-48, 105],
      [-5, 165],
    ] as RegionBounds,
  },
  {
    id: "nsw",
    label: "New South Wales",
    short: "NSW",
    // Full state + coastal pad (geojson ~141–153.6E, 37.5–28.2S)
    bounds: [
      [-37.86, 140.55],
      [-27.81, 154.06],
    ] as RegionBounds,
  },
  {
    id: "vic",
    label: "Victoria",
    short: "VIC",
    // Full state + Bass Strait pad (geojson ~141–150E, 39.1–34.0S)
    bounds: [
      [-39.48, 140.51],
      [-33.63, 150.43],
    ] as RegionBounds,
  },
  {
    id: "qld",
    label: "Queensland",
    short: "QLD",
    // Full mainland + Torres approaches + Coral Sea pad
    bounds: [
      [-29.53, 137.55],
      [-9.05, 154.05],
    ] as RegionBounds,
  },
  {
    id: "wa",
    label: "Western Australia",
    short: "WA",
    // Full mainland + Indian Ocean / Timor Sea pad (Steep Point → Kimberley)
    bounds: [
      [-35.55, 112.75],
      [-12.95, 129.45],
    ] as RegionBounds,
  },
  {
    id: "sa",
    label: "South Australia",
    short: "SA",
    // Full state + Bight pad (geojson ~129–141E, 38.1–26.0S)
    bounds: [
      [-38.41, 128.55],
      [-25.65, 141.45],
    ] as RegionBounds,
  },
  {
    id: "tas",
    label: "Tasmania",
    short: "TAS",
    // Full island + surrounding waters (geojson ~143.8–148.3E, 43.6–39.6S)
    bounds: [
      [-43.98, 143.38],
      [-39.23, 148.78],
    ] as RegionBounds,
  },
  {
    id: "nt",
    label: "Northern Territory",
    short: "NT",
    // Full territory + Top End waters (geojson ~129–138E, 26.0–11.1S)
    bounds: [
      [-26.35, 128.55],
      [-10.79, 138.45],
    ] as RegionBounds,
  },
  {
    id: "act",
    label: "Australian Capital Territory",
    short: "ACT",
    // Full ACT with framing pad so the territory isn't edge-clipped
    bounds: [
      [-36.05, 148.55],
      [-34.95, 149.60],
    ] as RegionBounds,
  },
] as const;

export type MapRegionId = (typeof MAP_REGIONS)[number]["id"];

export const DEFAULT_MAP_REGION: MapRegionId = "national";

export function getMapRegion(
  id: MapRegionId = DEFAULT_MAP_REGION,
): (typeof MAP_REGIONS)[number] {
  return MAP_REGIONS.find((r) => r.id === id) ?? MAP_REGIONS[0]!;
}

export function isMapRegionId(value: string): value is MapRegionId {
  return MAP_REGIONS.some((r) => r.id === value);
}

/** Demo “now” for Sydney — shared so every panel stays consistent. */
export const SYDNEY_NOW = {
  place: "Sydney, NSW",
  condition: "Partly cloudy",
  tempC: 22,
  feelsLikeC: 21,
  humidityPct: 68,
  wind: "18 km/h SSW",
  gusts: "32 km/h",
  rainTodayMm: 0,
  pressureHpa: 1013,
  minC: 16,
  maxC: 22,
  rainChancePct: 10,
  uv: "6 High",
  /** Fixed demo clock so labels stay stable in the shell. */
  clockLabel: "Wed 16 Sep · 4:32 PM AEST",
  dateHeading: "Wednesday 16 September",
} as const;

export const WARNINGS = [
  {
    id: "nsw-ts",
    states: ["NSW"],
    title: "Severe Thunderstorm Warning",
    detail: "Eastern NSW — damaging winds & large hail possible",
    tone: "amber",
  },
  {
    id: "qld-flood",
    states: ["QLD"],
    title: "Flood Warning",
    detail: "Coastal QLD catchments — heavy rain ongoing",
    tone: "sky",
  },
  {
    id: "nsw-marine",
    states: ["NSW"],
    title: "Marine Wind Warning",
    detail: "NSW coastal waters — strong winds & hazardous seas",
    tone: "violet",
  },
  {
    id: "qld-tc",
    states: ["QLD"],
    title: "Tropical Cyclone Watch",
    detail: "Far North QLD — monitoring developing system",
    tone: "cyan",
  },
] as const;

/** @deprecated Prefer live `/api/weather/warnings` states. */
export function warningStates(): string[] {
  const set = new Set<string>();
  for (const w of WARNINGS) {
    for (const s of w.states) set.add(s);
  }
  return [...set];
}

/** National briefing notes — not a repeat of the warning titles. */
export const HIGHLIGHTS = [
  "Storms favour the ranges of eastern NSW later this afternoon",
  "Heat building inland WA through the weekend",
  "Fresh to strong southerlies easing along the NSW coast overnight",
] as const;

/** Starts on “today” (Wed) so it matches SYDNEY_NOW. */
export const WEEK_FORECAST = [
  { day: "Wed", high: 22, low: 16, icon: "partly" },
  { day: "Thu", high: 21, low: 15, icon: "rain" },
  { day: "Fri", high: 19, low: 14, icon: "storm" },
  { day: "Sat", high: 20, low: 13, icon: "cloud" },
  { day: "Sun", high: 23, low: 15, icon: "sun" },
  { day: "Mon", high: 25, low: 16, icon: "partly" },
  { day: "Tue", high: 24, low: 17, icon: "sun" },
] as const;

/** @deprecated Home model panel uses live Open-Meteo comparison. */
export const MODEL_ROWS = [
  { metric: "Max Temp", ecmwf: "22°", access: "23°", gfs: "21°" },
  { metric: "Rain", ecmwf: "1 mm", access: "0 mm", gfs: "2 mm" },
  { metric: "Wind (km/h)", ecmwf: "18", access: "20", gfs: "17" },
  { metric: "Storm Chance", ecmwf: "40%", access: "35%", gfs: "45%" },
] as const;

export const CAPITAL_NOW = [
  { city: "Sydney", tempC: 22, wind: "SSW 18", condition: "Partly cloudy" },
  { city: "Melbourne", tempC: 15, wind: "S 22", condition: "Cloudy" },
  { city: "Brisbane", tempC: 26, wind: "NE 14", condition: "Mostly sunny" },
  { city: "Perth", tempC: 24, wind: "SW 20", condition: "Sunny" },
  { city: "Adelaide", tempC: 18, wind: "SW 25", condition: "Clearing" },
  { city: "Hobart", tempC: 13, wind: "NW 16", condition: "Shower or two" },
  { city: "Canberra", tempC: 14, wind: "NW 12", condition: "Partly cloudy" },
  { city: "Darwin", tempC: 31, wind: "E 18", condition: "Humid" },
] as const;

export const CITY_MARKERS: { name: string; lat: number; lon: number }[] = [
  { name: "Perth", lat: -31.95, lon: 115.86 },
  { name: "Darwin", lat: -12.46, lon: 130.84 },
  { name: "Brisbane", lat: -27.47, lon: 153.03 },
  { name: "Adelaide", lat: -34.93, lon: 138.6 },
  { name: "Sydney", lat: -33.87, lon: 151.21 },
  { name: "Melbourne", lat: -37.81, lon: 144.96 },
  { name: "Hobart", lat: -42.88, lon: 147.33 },
  { name: "Canberra", lat: -35.28, lon: 149.13 },
];
