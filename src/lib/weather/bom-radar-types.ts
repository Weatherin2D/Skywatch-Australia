/**
 * Client-safe BoM radar types + site registry (no Node/sharp deps).
 */

export type BomRadarRangeKm = 64 | 128 | 256;
export type BomRadarRangeCode = "2" | "3" | "4";
export type RadarViewMode = "composite" | "site";

export type BomRadarSite = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  defaultRange: BomRadarRangeCode;
};

export const BOM_RADAR_RANGE_OPTIONS: ReadonlyArray<{
  km: BomRadarRangeKm;
  code: BomRadarRangeCode;
  label: string;
}> = [
  { km: 64, code: "4", label: "64 km" },
  { km: 128, code: "3", label: "128 km" },
  { km: 256, code: "2", label: "256 km" },
];

export const BOM_RADAR_SITES: readonly BomRadarSite[] = [
  { code: "70", name: "Perth (Serpentine)", lat: -32.3917, lon: 115.8669, defaultRange: "4" },
  { code: "71", name: "Sydney (Terrey Hills)", lat: -33.7008, lon: 151.2098, defaultRange: "4" },
  { code: "66", name: "Brisbane (Mt Stapylton)", lat: -27.7178, lon: 153.24, defaultRange: "4" },
  { code: "50", name: "Brisbane (Marburg)", lat: -27.606, lon: 152.54, defaultRange: "3" },
  { code: "02", name: "Melbourne (Laverton)", lat: -37.855, lon: 144.752, defaultRange: "4" },
  { code: "64", name: "Adelaide (Buckland Park)", lat: -34.617, lon: 138.469, defaultRange: "4" },
  { code: "63", name: "Darwin (Berrimah)", lat: -12.457, lon: 130.925, defaultRange: "3" },
  { code: "76", name: "Hobart (Mt Koonya)", lat: -43.112, lon: 147.806, defaultRange: "3" },
  { code: "03", name: "Wollongong (Appin)", lat: -34.263, lon: 150.875, defaultRange: "3" },
  { code: "04", name: "Newcastle", lat: -32.73, lon: 152.026, defaultRange: "3" },
  { code: "40", name: "Canberra (Captains Flat)", lat: -35.661, lon: 149.512, defaultRange: "3" },
  { code: "49", name: "Yarrawonga", lat: -36.03, lon: 146.03, defaultRange: "3" },
  { code: "19", name: "Cairns", lat: -16.818, lon: 145.684, defaultRange: "3" },
  { code: "22", name: "Mackay", lat: -21.117, lon: 149.217, defaultRange: "3" },
  { code: "23", name: "Gladstone", lat: -23.855, lon: 151.263, defaultRange: "3" },
  { code: "08", name: "Gympie (Mt Kanigan)", lat: -25.957, lon: 152.577, defaultRange: "3" },
  { code: "28", name: "Grafton", lat: -29.622, lon: 152.963, defaultRange: "3" },
  { code: "69", name: "Namoi (Blackjack Mtn)", lat: -31.024, lon: 150.192, defaultRange: "3" },
  { code: "72", name: "Emerald", lat: -23.55, lon: 148.239, defaultRange: "3" },
  { code: "06", name: "Geraldton", lat: -28.805, lon: 114.698, defaultRange: "3" },
  { code: "15", name: "Dampier", lat: -20.654, lon: 116.683, defaultRange: "3" },
  { code: "17", name: "Broome", lat: -17.948, lon: 122.235, defaultRange: "3" },
  { code: "31", name: "Albany", lat: -34.942, lon: 117.817, defaultRange: "3" },
  { code: "32", name: "Esperance", lat: -33.83, lon: 121.892, defaultRange: "3" },
  { code: "39", name: "Halls Creek", lat: -18.229, lon: 127.663, defaultRange: "3" },
  { code: "44", name: "Giles", lat: -25.033, lon: 128.3, defaultRange: "3" },
  { code: "46", name: "Alice Springs", lat: -23.82, lon: 133.9, defaultRange: "3" },
  { code: "52", name: "NW Tasmania (West Takone)", lat: -41.181, lon: 145.528, defaultRange: "3" },
  { code: "93", name: "Brewarrina", lat: -29.974, lon: 146.814, defaultRange: "3" },
  { code: "95", name: "Warrego", lat: -26.44, lon: 146.27, defaultRange: "3" },
  { code: "106", name: "Townsville", lat: -19.42, lon: 146.55, defaultRange: "3" },
  { code: "107", name: "Warruwi", lat: -11.65, lon: 133.38, defaultRange: "3" },
  { code: "108", name: "Toowoomba", lat: -27.56, lon: 151.95, defaultRange: "3" },
] as const;

export function findBomRadarSite(code: string): BomRadarSite | undefined {
  return BOM_RADAR_SITES.find((s) => s.code === code);
}

export function rangeCodeToKm(code: BomRadarRangeCode): BomRadarRangeKm {
  if (code === "2") return 256;
  if (code === "3") return 128;
  return 64;
}

export function rangeKmToCode(km: BomRadarRangeKm): BomRadarRangeCode {
  if (km === 256) return "2";
  if (km === 128) return "3";
  return "4";
}

export function parseRadarRangeKm(raw: string | null | undefined): BomRadarRangeKm | null {
  if (raw === "64" || raw === "128" || raw === "256") return Number(raw) as BomRadarRangeKm;
  if (raw === "4") return 64;
  if (raw === "3") return 128;
  if (raw === "2") return 256;
  return null;
}

export function parseRadarViewMode(raw: string | null | undefined): RadarViewMode {
  return raw === "site" ? "site" : "composite";
}

/** Lat/lon box for a site's range — used to frame the map (WMTS tiles still cover AU). */
export function siteRadarBounds(
  site: BomRadarSite,
  rangeKm: BomRadarRangeKm = rangeCodeToKm(site.defaultRange),
): [[number, number], [number, number]] {
  const dLat = rangeKm / 111.32;
  const dLon = rangeKm / (111.32 * Math.cos((site.lat * Math.PI) / 180));
  return [
    [site.lat - dLat, site.lon - dLon],
    [site.lat + dLat, site.lon + dLon],
  ];
}
