import { PNG } from "pngjs";
import universalBlueDbz from "../../../data/rainviewer-universal-blue.json";

export type Rgba = readonly [number, number, number, number];

/**
 * RadarScope-inspired reflectivity ladder — saturated greens → yellow →
 * orange → red → magenta on a transparent void (no muddy dark stops).
 */
export const RADAR_DBZ_STOPS: ReadonlyArray<{ dbz: number; rgba: Rgba }> = [
  { dbz: 0, rgba: [0, 0, 0, 0] },
  { dbz: 10, rgba: [4, 55, 140, 200] },
  { dbz: 15, rgba: [0, 120, 210, 220] },
  { dbz: 20, rgba: [0, 180, 100, 230] },
  { dbz: 25, rgba: [20, 210, 40, 240] },
  { dbz: 30, rgba: [80, 230, 30, 245] },
  { dbz: 35, rgba: [180, 240, 20, 250] },
  { dbz: 40, rgba: [255, 230, 0, 255] },
  { dbz: 45, rgba: [255, 170, 0, 255] },
  { dbz: 50, rgba: [255, 100, 0, 255] },
  { dbz: 55, rgba: [240, 20, 20, 255] },
  { dbz: 60, rgba: [200, 0, 80, 255] },
  { dbz: 65, rgba: [255, 40, 200, 255] },
  { dbz: 70, rgba: [255, 160, 255, 255] },
  { dbz: 75, rgba: [255, 255, 255, 255] },
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

/**
 * RainViewer z8+ “empty” placeholders are mostly semi-transparent black/white
 * checkers — not real reflectivity. Treat as fully transparent.
 */
export function isRainviewerPlaceholderPng(input: Buffer): boolean {
  try {
    const png = PNG.sync.read(input);
    const { data, width, height } = png;
    const total = width * height;
    if (total < 64) return true;
    let opaque = 0;
    let placeholderish = 0;
    // Sample every 8th pixel for speed.
    for (let i = 0; i < data.length; i += 32) {
      const a = data[i + 3]!;
      if (a === 0) continue;
      opaque += 1;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Near-black or near-white with partial alpha, or flat grey.
      if (
        (max <= 45 && a < 220) ||
        (min >= 210 && a < 240) ||
        (max - min <= 8 && max <= 60 && a < 200)
      ) {
        placeholderish += 1;
      }
    }
    if (opaque === 0) return false; // already empty — fine
    return placeholderish / opaque >= 0.85;
  } catch {
    return false;
  }
}

const TRANSPARENT_TILE_PNG: Buffer = (() => {
  const png = new PNG({ width: 1, height: 1 });
  png.data[0] = 0;
  png.data[1] = 0;
  png.data[2] = 0;
  png.data[3] = 0;
  return PNG.sync.write(png);
})();

export function transparentRadarTilePng(): Buffer {
  return Buffer.from(TRANSPARENT_TILE_PNG);
}

/**
 * Sample parent RGBA with premultiplied-alpha bilinear filtering.
 * Transparent neighbours do not bleed grey into rain cells.
 */
function sampleBilinearPremul(
  data: Uint8Array,
  srcSize: number,
  fx: number,
  fy: number,
): [number, number, number, number] {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(srcSize - 1, x0 + 1);
  const y1 = Math.min(srcSize - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const x0c = Math.max(0, Math.min(srcSize - 1, x0));
  const y0c = Math.max(0, Math.min(srcSize - 1, y0));

  const read = (x: number, y: number) => {
    const i = (y * srcSize + x) << 2;
    const a = data[i + 3]! / 255;
    return [
      data[i]! * a,
      data[i + 1]! * a,
      data[i + 2]! * a,
      a,
    ] as const;
  };

  const c00 = read(x0c, y0c);
  const c10 = read(x1, y0c);
  const c01 = read(x0c, y1);
  const c11 = read(x1, y1);

  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const r = mix(mix(c00[0], c10[0], tx), mix(c01[0], c11[0], tx), ty);
  const g = mix(mix(c00[1], c10[1], tx), mix(c01[1], c11[1], tx), ty);
  const b = mix(mix(c00[2], c10[2], tx), mix(c01[2], c11[2], tx), ty);
  const a = mix(mix(c00[3], c10[3], tx), mix(c01[3], c11[3], tx), ty);
  if (a < 0.02) return [0, 0, 0, 0];
  return [
    clampByte(r / a),
    clampByte(g / a),
    clampByte(b / a),
    clampByte(a * 255),
  ];
}

/**
 * Crop a child tile out of a recoloured native parent and bilinear-upscale
 * to the parent tile size (512²). Used when z > RADAR_NATIVE_MAX_ZOOM so
 * state/metro zooms stay smooth instead of nearest-neighbour blocks.
 */
export function extractOverzoomTile(
  parentPng: Buffer,
  scale: number,
  childX: number,
  childY: number,
): Buffer {
  if (scale <= 1) return parentPng;
  const parent = PNG.sync.read(parentPng);
  const srcSize = parent.width;
  const outSize = srcSize;
  const childSize = srcSize / scale;
  if (!Number.isFinite(childSize) || childSize < 1) {
    return transparentRadarTilePng();
  }
  const ox = (childX % scale) * childSize;
  const oy = (childY % scale) * childSize;
  const out = new PNG({ width: outSize, height: outSize });
  const src = parent.data;
  // Sample at pixel centres; slight inset avoids bleeding past the crop edge.
  const maxCoord = srcSize - 1.001;
  for (let y = 0; y < outSize; y++) {
    const fy = Math.min(
      maxCoord,
      Math.max(0, oy + ((y + 0.5) * childSize) / outSize - 0.5),
    );
    for (let x = 0; x < outSize; x++) {
      const fx = Math.min(
        maxCoord,
        Math.max(0, ox + ((x + 0.5) * childSize) / outSize - 0.5),
      );
      const [r, g, b, a] = sampleBilinearPremul(src, srcSize, fx, fy);
      const di = (y * outSize + x) << 2;
      out.data[di] = r;
      out.data[di + 1] = g;
      out.data[di + 2] = b;
      out.data[di + 3] = a;
    }
  }
  return PNG.sync.write(out);
}

/**
 * RainViewer serves useful reflectivity only through ~z7. Higher zooms return
 * empty/placeholder tiles — Leaflet must overzoom from this native max.
 */
export const RADAR_NATIVE_MAX_ZOOM = 7;

/** RainViewer 512² tiles — highest public size, same geographic coverage as 256. */
export const RAINVIEWER_TILE_SIZE = 512 as const;

/** Upstream RainViewer tile URL — Universal Blue, unsmoothed (`0_0`), no snow. */
export function rainviewerRawTileUrl(
  host: string,
  path: string,
  z: number | string,
  x: number | string,
  y: number | string,
  size: 256 | 512 = RAINVIEWER_TILE_SIZE,
): string {
  const base = `${host.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  // colour=2 Universal Blue; options=0_0 = no smooth, no snow
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
  const maxNative = RADAR_NATIVE_MAX_ZOOM;
  for (const z of zooms) {
    if (z < 0 || z > maxNative) continue;
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
