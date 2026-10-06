/**
 * BoM per-site IDR reflectivity GIFs — chrome-masked for metro Site mode.
 * ~125 m/px at 64 km (much denser than national WMTS ~1 km).
 */

import sharp from "sharp";
import { PNG } from "pngjs";
import { colourForDbz } from "@/lib/weather/radar-palette";
import {
  BOM_RADAR_SITES,
  findBomRadarSite,
  rangeCodeToKm,
  rangeKmToCode,
  siteRadarBounds,
  type BomRadarRangeKm,
  type BomRadarSite,
} from "@/lib/weather/bom-radar-types";

export {
  BOM_RADAR_SITES,
  findBomRadarSite,
  rangeCodeToKm,
  rangeKmToCode,
  parseRadarRangeKm,
  siteRadarBounds,
  type BomRadarRangeKm,
  type BomRadarRangeCode,
  type BomRadarSite,
} from "@/lib/weather/bom-radar-types";

/** BoM rain palette — skip near-white so labels cannot match as rain. */
const RAIN_COLORS: ReadonlyArray<{
  rgba: readonly [number, number, number, number];
  dbz: number;
}> = [
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

function buildRecolour() {
  const map = new Map<number, number>();
  for (const { rgba, dbz } of RAIN_COLORS) {
    const [nr, ng, nb, na] = colourForDbz(dbz);
    map.set(pack(rgba[0], rgba[1], rgba[2], rgba[3]), pack(nr, ng, nb, na));
  }
  return map;
}

const RECOLOUR = buildRecolour();

function matchPalette(r: number, g: number, b: number, a: number): number {
  if (a < 10) return 0;
  if (r + g + b < 40) return 0;
  if (r > 230 && g > 230 && b > 230) return 0;
  const hit = RECOLOUR.get(pack(r, g, b, a));
  if (hit != null) return hit;
  let best = 0;
  let bestD = 18;
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

export function siteRadarProductId(
  site: BomRadarSite,
  rangeKm: BomRadarRangeKm = rangeCodeToKm(site.defaultRange),
): string {
  return `IDR${site.code}${rangeKmToCode(rangeKm)}`;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function bomHeaders(accept: string): Record<string, string> {
  return {
    Accept: accept,
    "Accept-Language": "en-AU,en;q=0.9",
    "User-Agent": USER_AGENT,
    Referer: "https://www.bom.gov.au/weather-and-climate/rain-radar-and-weather-maps",
    Origin: "https://www.bom.gov.au",
  };
}

type CacheEntry = {
  at: number;
  png: Buffer;
  bounds: [[number, number], [number, number]];
  productId: string;
};
const g = globalThis as typeof globalThis & {
  __skywatchBomSiteRadarV3?: Map<string, CacheEntry>;
};
function siteCache(): Map<string, CacheEntry> {
  if (!g.__skywatchBomSiteRadarV3) g.__skywatchBomSiteRadarV3 = new Map();
  return g.__skywatchBomSiteRadarV3;
}
const SITE_TTL_MS = 55_000;

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: bomHeaders("image/*,*/*"),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32) return null;
    return buf;
  } catch {
    return null;
  }
}

async function loadMaskAlpha(
  productId: string,
  kind: "locations" | "range" | "topography",
  side: number,
): Promise<Uint8Array | null> {
  const url = `https://www.bom.gov.au/products/radar_transparencies/${productId}.${kind}.png`;
  const buf = await fetchBuffer(url);
  if (!buf || buf[0] !== 0x89) return null;
  try {
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = new Uint8Array(side * side);
    const w = info.width;
    const h = info.height;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        if (x >= w || y >= h) {
          alpha[y * side + x] = 0;
          continue;
        }
        const i = (y * w + x) << 2;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const a = data[i + 3]!;
        const opaque = a > 20 && r + g + b > 30;
        alpha[y * side + x] = opaque ? 255 : 0;
      }
    }
    return alpha;
  } catch {
    return null;
  }
}

export async function fetchSiteRadarPng(
  site: BomRadarSite,
  rangeKm: BomRadarRangeKm = rangeCodeToKm(site.defaultRange),
): Promise<{ png: Buffer; bounds: [[number, number], [number, number]]; productId: string }> {
  const productId = siteRadarProductId(site, rangeKm);
  const cacheKey = `${productId}|${rangeKm}`;
  const cached = siteCache().get(cacheKey);
  if (cached && Date.now() - cached.at < SITE_TTL_MS) {
    return { png: cached.png, bounds: cached.bounds, productId };
  }

  const url = `https://www.bom.gov.au/radar/${productId}.gif`;
  const gif = await fetchBuffer(url);
  if (!gif) throw new Error(`IDR ${productId} unavailable`);

  const { data, info } = await sharp(gif)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const side = Math.min(512, info.width, info.height);
  const [locMask, rangeMask, topoMask] = await Promise.all([
    loadMaskAlpha(productId, "locations", side),
    loadMaskAlpha(productId, "range", side),
    loadMaskAlpha(productId, "topography", side),
  ]);

  const out = new PNG({ width: side, height: side });
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const di = (y * side + x) << 2;
      const mi = y * side + x;
      if (
        (locMask && locMask[mi]! > 0) ||
        (rangeMask && rangeMask[mi]! > 0) ||
        (topoMask && topoMask[mi]! > 0)
      ) {
        out.data[di] = 0;
        out.data[di + 1] = 0;
        out.data[di + 2] = 0;
        out.data[di + 3] = 0;
        continue;
      }
      const si = (y * info.width + x) << 2;
      const packed = matchPalette(
        data[si]!,
        data[si + 1]!,
        data[si + 2]!,
        data[si + 3]!,
      );
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
  const bounds = siteRadarBounds(site, rangeKm);
  siteCache().set(cacheKey, { at: Date.now(), png, bounds, productId });
  return { png, bounds, productId };
}
