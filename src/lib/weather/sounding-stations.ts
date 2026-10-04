import type { SoundingStation } from "@/lib/weather/sounding-types";

/** Australian radiosonde / upper-air sites (WMO ids for UWYO). */
export const SOUNDING_STATIONS: SoundingStation[] = [
  { wmo: "94120", name: "Darwin Airport", state: "NT", lat: -12.42, lon: 130.89 },
  { wmo: "94203", name: "Broome Airport", state: "WA", lat: -17.95, lon: 122.23 },
  { wmo: "94294", name: "Weipa Aero", state: "QLD", lat: -12.68, lon: 141.92 },
  { wmo: "94312", name: "Port Hedland", state: "WA", lat: -20.38, lon: 118.63 },
  { wmo: "94326", name: "Alice Springs", state: "NT", lat: -23.8, lon: 133.89 },
  { wmo: "94332", name: "Mount Isa", state: "QLD", lat: -20.68, lon: 139.49 },
  { wmo: "94374", name: "Rockhampton", state: "QLD", lat: -23.38, lon: 150.48 },
  { wmo: "94430", name: "Meekatharra", state: "WA", lat: -26.61, lon: 118.54 },
  { wmo: "94510", name: "Charleville", state: "QLD", lat: -26.41, lon: 146.26 },
  { wmo: "94578", name: "Brisbane Airport", state: "QLD", lat: -27.39, lon: 153.13 },
  { wmo: "94610", name: "Perth Airport", state: "WA", lat: -31.93, lon: 115.98 },
  { wmo: "94659", name: "Woomera", state: "SA", lat: -31.2, lon: 136.81 },
  { wmo: "94672", name: "Adelaide Airport", state: "SA", lat: -34.95, lon: 138.52 },
  { wmo: "94711", name: "Cobar", state: "NSW", lat: -31.53, lon: 145.75 },
  { wmo: "94767", name: "Sydney Airport", state: "NSW", lat: -33.95, lon: 151.18 },
  { wmo: "94776", name: "Williamtown", state: "NSW", lat: -32.79, lon: 151.84 },
  { wmo: "94821", name: "Mount Gambier", state: "SA", lat: -37.75, lon: 140.77 },
  { wmo: "94866", name: "Melbourne Airport", state: "VIC", lat: -37.67, lon: 144.84 },
  { wmo: "94970", name: "Hobart Airport", state: "TAS", lat: -42.83, lon: 147.5 },
  { wmo: "94975", name: "Macquarie Island", state: "TAS", lat: -54.5, lon: 158.94 },
];

export function getSoundingStation(wmo: string): SoundingStation | null {
  return SOUNDING_STATIONS.find((s) => s.wmo === wmo) ?? null;
}

export function nearestSoundingStation(
  lat: number,
  lon: number,
): SoundingStation {
  let best = SOUNDING_STATIONS[0]!;
  let bestD = Infinity;
  for (const s of SOUNDING_STATIONS) {
    const d =
      (s.lat - lat) ** 2 +
      ((s.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
