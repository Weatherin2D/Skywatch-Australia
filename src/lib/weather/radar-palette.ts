import { PNG } from "pngjs";
import universalBlueDbz from "../../../data/rainviewer-universal-blue.json";

export type Rgba = readonly [number, number, number, number];

/**
 * SkyWatch dBZ colour stops — raw RainViewer reflectivity remapped to this
 * ladder (value, [r,g,b,a]).
 */
export const RADAR_DBZ_STOPS: ReadonlyArray<{ dbz: number; rgba: Rgba }> = [
  { dbz: 0, rgba: [0, 0, 0, 255] },
  { dbz: 10, rgba: [75, 62, 217, 255] },
  { dbz: 15, rgba: [99, 208, 255, 255] },
  { dbz: 22, rgba: [50, 60, 128, 255] },
  { dbz: 25, rgba: [29, 32, 94, 255] },
  { dbz: 30, rgba: [140, 227, 100, 255] },
  { dbz: 33, rgba: [42, 94, 50, 255] },
  { dbz: 35, rgba: [11, 56, 41, 255] },
  { dbz: 40, rgba: [215, 224, 90, 255] },
  { dbz: 44, rgba: [212, 168, 59, 255] },
  { dbz: 46, rgba: [255, 112, 60, 255] },
  { dbz: 48, rgba: [240, 22, 22, 255] },
  { dbz: 50, rgba: [143, 2, 2, 255] },
  { dbz: 52, rgba: [247, 47, 215, 255] },
  { dbz: 56, rgba: [128, 35, 126, 255] },
  { dbz: 60, rgba: [65, 27, 69, 255] },
  { dbz: 65, rgba: [115, 230, 151, 255] },
  { dbz: 68, rgba: [21, 66, 30, 255] },
  { dbz: 70, rgba: [117, 230, 220, 255] },
  { dbz: 75, rgba: [0, 236, 252, 255] },
  { dbz: 80, rgba: [130, 88, 48, 255] },
  { dbz: 85, rgba: [92, 60, 32, 255] },
  { dbz: 90, rgba: [0, 0, 0, 255] },
  { dbz: 255, rgba: [255, 255, 255, 255] },
] as const;

const UB_DBZ = universalBlueDbz as Record<string, number>;

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function colourForDbz(dbz: number): Rgba {
  const stops = RADAR_DBZ_STOPS;
  if (dbz < 0) return [0, 0, 0, 0];
  const first = stops[0]!;
  if (dbz <= first.dbz) return first.rgba;
  const last = stops[stops.length - 1]!;
  if (dbz >= last.dbz) return last.rgba;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (dbz >= a.dbz && dbz <= b.dbz) {
      const t = (dbz - a.dbz) / (b.dbz - a.dbz || 1);
      return [
        clampByte(lerp(a.rgba[0], b.rgba[0], t)),
        clampByte(lerp(a.rgba[1], b.rgba[1], t)),
        clampByte(lerp(a.rgba[2], b.rgba[2], t)),
        clampByte(lerp(a.rgba[3], b.rgba[3], t)),
      ];
    }
  }
  return last.rgba;
}

/** Precomputed custom palette for integer dBZ −32…255. */
const CUSTOM_LUT: Rgba[] = (() => {
  const lut: Rgba[] = [];
  for (let dbz = -32; dbz <= 255; dbz++) {
    lut.push(colourForDbz(dbz));
  }
  return lut;
})();

function packRgba(r: number, g: number, b: number, a: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/** Universal Blue packed RGBA → SkyWatch packed RGBA (0 = transparent). */
const RECOLOUR_MAP = new Map<number, number>();
for (const [hex, dbz] of Object.entries(UB_DBZ)) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = parseInt(hex.slice(6, 8), 16);
  const idx = Math.max(0, Math.min(CUSTOM_LUT.length - 1, dbz + 32));
  const [nr, ng, nb, na] = CUSTOM_LUT[idx]!;
  RECOLOUR_MAP.set(packRgba(r, g, b, a), packRgba(nr, ng, nb, na));
}

/**
 * Exact LUT hits cover nearly all RainViewer Universal Blue pixels. Scanning
 * the full palette for every unmatched pixel was the dominant tile CPU cost —
 * treat rare mismatches as transparent instead.
 */
function nearestRecolour(
  _r: number,
  _g: number,
  _b: number,
  _a: number,
): number {
  return 0;
}

/**
 * Recolour a RainViewer Universal Blue (unsmoothed) PNG into the SkyWatch
 * dBZ palette. Transparent / unmatched pixels stay transparent.
 */
export function recolourRadarPng(input: Buffer): Buffer {
  const png = PNG.sync.read(input);
  const { data } = png;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const packed = packRgba(r, g, b, a);
    let out = RECOLOUR_MAP.get(packed);
    if (out == null) out = nearestRecolour(r, g, b, a);
    if (out === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
      continue;
    }
    data[i] = (out >>> 24) & 255;
    data[i + 1] = (out >>> 16) & 255;
    data[i + 2] = (out >>> 8) & 255;
    data[i + 3] = out & 255;
  }

  return PNG.sync.write(png);
}

/** Upstream RainViewer tile URL — Universal Blue, unsmoothed, no snow. */
export function rainviewerRawTileUrl(
  host: string,
  path: string,
  z: number | string,
  x: number | string,
  y: number | string,
  size: 256 | 512 = 256,
): string {
  const base = `${host.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  return `${base}/${size}/${z}/${x}/${y}/2/0_0.png`;
}

const DEG2RAD = Math.PI / 180;

/** Web-mercator tile X for longitude at zoom z. */
function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return ((lon + 180) / 360) * n;
}

/** Web-mercator tile Y for latitude at zoom z. */
function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = clamped * DEG2RAD;
  return (
    (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n
  );
}

export type RadarWarmupBounds = {
  /** South, west, north, east in degrees. */
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Default Australia-ish mercator window used when no bounds are supplied. */
const AU_WARMUP_BOUNDS: RadarWarmupBounds = {
  south: -45,
  west: 110,
  north: -8,
  east: 155,
};

function expandTemplate(
  template: string,
  z: number,
  x: number,
  y: number,
): string {
  return template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
}

/**
 * Expand a Leaflet tile template for warm-up over a lat/lng window
 * (defaults to Australia). Caps tiles per zoom so high zooms stay cheap.
 */
export function radarWarmupTileUrls(
  template: string,
  zooms: number[] = [4, 5, 6],
  bounds: RadarWarmupBounds = AU_WARMUP_BOUNDS,
  maxTilesPerZoom = 64,
): string[] {
  const urls: string[] = [];
  for (const z of zooms) {
    if (z < 0 || z > 12) continue;
    const n = 2 ** z;
    let x0 = Math.floor(lonToTileX(bounds.west, z)) - 1;
    let x1 = Math.ceil(lonToTileX(bounds.east, z)) + 1;
    let y0 = Math.floor(latToTileY(bounds.north, z)) - 1;
    let y1 = Math.ceil(latToTileY(bounds.south, z)) + 1;
    x0 = Math.max(0, x0);
    x1 = Math.min(n - 1, x1);
    y0 = Math.max(0, y0);
    y1 = Math.min(n - 1, y1);

    const width = x1 - x0 + 1;
    const height = y1 - y0 + 1;
    if (width * height > maxTilesPerZoom) {
      // Shrink to a centred window so we still hit the viewport core.
      const maxSide = Math.max(1, Math.floor(Math.sqrt(maxTilesPerZoom)));
      const cx = Math.floor((x0 + x1) / 2);
      const cy = Math.floor((y0 + y1) / 2);
      const half = Math.floor(maxSide / 2);
      x0 = Math.max(0, cx - half);
      x1 = Math.min(n - 1, x0 + maxSide - 1);
      y0 = Math.max(0, cy - half);
      y1 = Math.min(n - 1, y0 + maxSide - 1);
    }

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        urls.push(expandTemplate(template, z, x, y));
      }
    }
  }
  return urls;
}
