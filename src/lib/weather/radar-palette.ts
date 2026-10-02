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

const UB_ENTRIES: Array<{
  r: number;
  g: number;
  b: number;
  a: number;
  dbz: number;
}> = Object.entries(UB_DBZ).map(([hex, dbz]) => ({
  r: parseInt(hex.slice(0, 2), 16),
  g: parseInt(hex.slice(2, 4), 16),
  b: parseInt(hex.slice(4, 6), 16),
  a: parseInt(hex.slice(6, 8), 16),
  dbz,
}));

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function colourForDbz(dbz: number): Rgba {
  const stops = RADAR_DBZ_STOPS;
  // No reflectivity / below scale → fully clear.
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

function rgbaKey(r: number, g: number, b: number, a: number): string {
  return (
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0") +
    a.toString(16).padStart(2, "0")
  );
}

/** Exact Universal Blue match, else nearest opaque palette colour. */
function dbzFromUniversalBlue(
  r: number,
  g: number,
  b: number,
  a: number,
): number | null {
  if (a === 0) return null;
  const exact = UB_DBZ[rgbaKey(r, g, b, a)];
  if (exact != null) return exact;

  let bestDbz: number | null = null;
  let bestDist = Infinity;
  for (const entry of UB_ENTRIES) {
    const dist =
      (r - entry.r) ** 2 +
      (g - entry.g) ** 2 +
      (b - entry.b) ** 2 +
      (a - entry.a) ** 2 * 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestDbz = entry.dbz;
    }
  }
  if (bestDist > 48 * 48) return null;
  return bestDbz;
}

/**
 * Recolour a RainViewer Universal Blue (unsmoothed) PNG into the SkyWatch
 * dBZ palette. Transparent / unmatched pixels stay transparent.
 */
export function recolourRadarPng(input: Buffer): Buffer {
  const png = PNG.sync.read(input);
  const { data } = png;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    const dbz = dbzFromUniversalBlue(r, g, b, a);
    if (dbz == null) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
      continue;
    }
    const idx = Math.max(0, Math.min(CUSTOM_LUT.length - 1, dbz + 32));
    const [nr, ng, nb, na] = CUSTOM_LUT[idx]!;
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
    data[i + 3] = na;
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
