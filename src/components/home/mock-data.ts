export const WEATHER_LAYERS = [
  { id: "radar", label: "Radar" },
  { id: "satellite", label: "Satellite" },
  { id: "lightning", label: "Lightning" },
  { id: "rainfall", label: "Rainfall (accumulation)" },
  { id: "wind", label: "Wind" },
  { id: "gusts", label: "Wind Gusts" },
  { id: "temperature", label: "Temperature" },
  { id: "dewpoint", label: "Dew Point" },
  { id: "pressure", label: "Pressure" },
  { id: "humidity", label: "Humidity" },
  { id: "clouds", label: "Clouds" },
  { id: "warnings", label: "Severe Weather Warnings" },
] as const;

export type LayerId = (typeof WEATHER_LAYERS)[number]["id"];

export const MAP_MODES = [
  "Map",
  "Satellite",
  "Radar",
  "Lightning",
  "Wind",
  "Temperature",
  "Rainfall",
  "Pressure",
] as const;

export type MapMode = (typeof MAP_MODES)[number];

export const QUICK_VIEW = [
  { label: "Temperature", value: "22°C" },
  { label: "Rainfall", value: "0 mm" },
  { label: "Wind", value: "18 km/h SSW" },
  { label: "Gusts", value: "32 km/h" },
  { label: "Humidity", value: "68%" },
  { label: "Pressure", value: "1013 hPa" },
] as const;

export const WARNINGS = [
  {
    title: "Severe Thunderstorm Warning",
    detail: "Eastern NSW — damaging winds & large hail possible",
    tone: "amber",
  },
  {
    title: "Flood Warning",
    detail: "Coastal QLD catchments — heavy rain ongoing",
    tone: "sky",
  },
  {
    title: "Marine Wind Warning",
    detail: "NSW coastal waters — strong winds & hazardous seas",
    tone: "violet",
  },
  {
    title: "Tropical Cyclone Watch",
    detail: "Far North QLD — monitoring developing system",
    tone: "cyan",
  },
] as const;

export const HIGHLIGHTS = [
  "High storm risk for eastern NSW and QLD this afternoon",
  "Heatwave conditions building across inland WA",
  "Damaging wind gusts possible along the NSW coast overnight",
  "Fire danger elevated in southern SA",
] as const;

export const WEEK_FORECAST = [
  { day: "Tue", high: 22, low: 16, icon: "partly" },
  { day: "Wed", high: 24, low: 17, icon: "sun" },
  { day: "Thu", high: 21, low: 15, icon: "rain" },
  { day: "Fri", high: 19, low: 14, icon: "storm" },
  { day: "Sat", high: 20, low: 13, icon: "cloud" },
  { day: "Sun", high: 23, low: 15, icon: "sun" },
  { day: "Mon", high: 25, low: 16, icon: "partly" },
] as const;

export const MODEL_ROWS = [
  { metric: "Max Temp", ecmwf: "22°", access: "23°", gfs: "21°" },
  { metric: "Rain", ecmwf: "1 mm", access: "0 mm", gfs: "2 mm" },
  { metric: "Wind", ecmwf: "18", access: "20", gfs: "17" },
  { metric: "Storm Chance", ecmwf: "40%", access: "35%", gfs: "45%" },
] as const;

export const CITY_MARKERS: { name: string; lat: number; lon: number }[] = [
  { name: "Perth", lat: -31.95, lon: 115.86 },
  { name: "Darwin", lat: -12.46, lon: 130.84 },
  { name: "Brisbane", lat: -27.47, lon: 153.03 },
  { name: "Adelaide", lat: -34.93, lon: 138.6 },
  { name: "Sydney", lat: -33.87, lon: 151.21 },
  { name: "Melbourne", lat: -37.81, lon: 144.96 },
  { name: "Hobart", lat: -42.88, lon: 147.33 },
];
