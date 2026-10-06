/**
 * BoM per-site IDR radar GIFs — georeferenced for metro/chase zooms.
 */

import sharp from "sharp";
import { PNG } from "pngjs";
import { colourForDbz } from "@/lib/weather/radar-palette";

export type BomRadarSite = {
  /** Numeric site id used in IDR{code}{range}.gif */
  code: string;
  name: string;
  lat: number;
  lon: number;
  /** Preferred range product: 4=64km, 3=128km, 2=256km, 1=512km */
  defaultRange: "1" | "2" | "3" | "4";
};

/** Major Australian radars (centres approximate). */
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

const RANGE_KM: Record<BomRadarSite["defaultRange"], number> = {
  "1": 512,
  "2": 256,
  "3": 128,
  "4": 64,
};

/** Same rain colours as national WMTS — land/chrome is stripped. */
const RAIN_COLORS: ReadonlyArray<{
  rgba: readonly [number, number, number, number];
  dbz: number;
}> = [
  { rgba: [245, 245, 255, 255], dbz: 12 },
  { rgba: [180, 180, 255, 255], dbz: 20 },
  { rgba: [120, 120, 255, 255], dbz: 26 },
  { rgba: [20, 20, 255, 255], dbz: 32 },
  { rgba: [0, 216, 195, 255], dbz: 36 },
  { rgba: [0, 150, 144, 255], dbz: 40 },
  { rgba: [0, 102, 102, 255], dbz: 44 },
  { rgba: [255, 255, 0, 255], dbz: 48 },
  { rgba: [255, 200, 0, 255], dbz: 50 },
  { rgba: [255, 150, 0, 255], dbz: 53 },
  { rgba: [255, 100, 0, 255], dbz: 56 },
  { rgba: [255, 0, 0, 255], dbz: 60 },
  { rgba: [200, 0, 0, 255], dbz: 65 },
  { rgba: [120, 0, 0, 255], dbz: 70 },
];

function pack(r: number, g: number, b: number, a: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

const RECOLOUR = new Map<number, number>();
for (const { rgba, dbz } of RAIN_COLORS) {
  const [nr, ng, nb, na] = colourForDbz(dbz);
  RECOLOUR.set(pack(rgba[0], rgba[1], rgba[2], rgba[3]), pack(nr, ng, nb, na));
}

function matchRain(r: number, g: number, b: number, a: number): number {
  if (a < 10) return 0;
  const exact = RECOLOUR.get(pack(r, g, b, a));
  if (exact != null) return exact;
  let best = 0;
  let bestD = 36;
  for (const { rgba, dbz } of RAIN_COLORS) {
    const dr = r - rgba[0];
    const dg = g - rgba[1];
    const db = b - rgba[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      const [nr, ng, nb, na] = colourForDbz(dbz);
      best = pack(nr, ng, nb, na);
    }
  }
  return best;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestBomRadarSites(
  lat: number,
  lon: number,
  limit = 2,
): BomRadarSite[] {
  return [...BOM_RADAR_SITES]
    .map((s) => ({ s, d: haversineKm(lat, lon, s.lat, s.lon) }))
    // Only sites whose coverage can reach the viewport centre (+ small pad).
    .filter(({ s, d }) => d <= RANGE_KM[s.defaultRange] + 40)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.s);
}

export function siteRadarBounds(
  site: BomRadarSite,
  range: BomRadarSite["defaultRange"] = site.defaultRange,
): [[number, number], [number, number]] {
  const km = RANGE_KM[range];
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((site.lat * Math.PI) / 180));
  return [
    [site.lat - dLat, site.lon - dLon],
    [site.lat + dLat, site.lon + dLon],
  ];
}

export function siteRadarProductId(
  site: BomRadarSite,
  range: BomRadarSite["defaultRange"] = site.defaultRange,
): string {
  return `IDR${site.code}${range}`;
}

export type SiteRadarFrame = {
  code: string;
  productId: string;
  name: string;
  /** PNG data URL or same-origin API url */
  imageUrl: string;
  bounds: [[number, number], [number, number]];
  generated: number;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type CacheEntry = { at: number; png: Buffer; bounds: [[number, number], [number, number]]; name: string; productId: string };
const g = globalThis as typeof globalThis & {
  __skywatchBomSiteRadar?: Map<string, CacheEntry>;
};
function siteCache(): Map<string, CacheEntry> {
  if (!g.__skywatchBomSiteRadar) g.__skywatchBomSiteRadar = new Map();
  return g.__skywatchBomSiteRadar;
}
const SITE_TTL_MS = 55_000;

/**
 * Fetch latest IDR GIF, strip land/chrome, remap rain to SkyWatch dBZ PNG.
 */
export async function fetchSiteRadarPng(
  site: BomRadarSite,
  range: BomRadarSite["defaultRange"] = site.defaultRange,
): Promise<{ png: Buffer; bounds: [[number, number], [number, number]]; productId: string }> {
  const productId = siteRadarProductId(site, range);
  const cached = siteCache().get(productId);
  if (cached && Date.now() - cached.at < SITE_TTL_MS) {
    return { png: cached.png, bounds: cached.bounds, productId };
  }

  const url = `https://www.bom.gov.au/radar/${productId}.gif`;
  const res = await fetch(url, {
    headers: {
      Accept: "image/gif,image/*,*/*",
      "Accept-Language": "en-AU,en;q=0.9",
      "User-Agent": USER_AGENT,
      Referer: "https://www.bom.gov.au/weather-and-climate/rain-radar-and-weather-maps",
      Origin: "https://www.bom.gov.au",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`IDR ${productId} HTTP ${res.status}`);
  const gif = Buffer.from(await res.arrayBuffer());

  const { data, info } = await sharp(gif)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Radar field is the top-left square (legend/chrome sits outside).
  const side = Math.min(512, info.width, info.height);
  const out = new PNG({ width: side, height: side });
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const si = (y * info.width + x) << 2;
      const di = (y * side + x) << 2;
      const packed = matchRain(data[si]!, data[si + 1]!, data[si + 2]!, data[si + 3]!);
      if (packed === 0) {
        out.data[di] = 0;
        out.data[di + 1] = 0;
        out.data[di + 2] = 0;
        out.data[di + 3] = 0;
      } else {
        out.data[di] = (packed >>> 24) & 255;
        out.data[di + 1] = (packed >>> 16) & 255;
        out.data[di + 2] = (packed >>> 8) & 255;
        out.data[di + 3] = packed & 255;
      }
    }
  }

  const png = PNG.sync.write(out);
  const bounds = siteRadarBounds(site, range);
  siteCache().set(productId, {
    at: Date.now(),
    png,
    bounds,
    name: site.name,
    productId,
  });
  return { png, bounds, productId };
}

export function findBomRadarSite(code: string): BomRadarSite | undefined {
  return BOM_RADAR_SITES.find((s) => s.code === code);
}
