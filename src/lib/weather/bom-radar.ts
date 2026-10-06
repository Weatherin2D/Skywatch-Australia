/**
 * Bureau of Meteorology rain reflectivity (WMTS timeseries) → Leaflet XYZ.
 *
 * Source: api.bom.gov.au mapping timeseries WMTS
 * Layer: atm_surf_air_precip_reflectivity_dbz
 * Matrix: GoogleMapsCompatible_BoM (AU-cropped, same m/px as Google zooms)
 */

import { PNG } from "pngjs";
import { colourForDbz, transparentRadarTilePng } from "@/lib/weather/radar-palette";

export const BOM_RADAR_LAYER = "atm_surf_air_precip_reflectivity_dbz";
export const BOM_RADAR_TMS = "GoogleMapsCompatible_BoM";
export const BOM_RADAR_NATIVE_MAX_ZOOM = 8;
export const BOM_RADAR_ATTRIBUTION =
  "Radar © Commonwealth of Australia (Bureau of Meteorology)";

const CAPS_URL =
  "https://api.bom.gov.au/apikey/v1/mapping/timeseries/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities";
const WMTS_KVP =
  "https://api.bom.gov.au/apikey/v1/mapping/timeseries/wmts";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER =
  "https://www.bom.gov.au/weather-and-climate/rain-radar-and-weather-maps";

function bomHeaders(accept: string): Record<string, string> {
  return {
    Accept: accept,
    "Accept-Language": "en-AU,en;q=0.9",
    "User-Agent": USER_AGENT,
    Referer: REFERER,
    Origin: "https://www.bom.gov.au",
  };
}

const ORIGIN = -20037508.342789244;
const INITIAL_RES = 156543.03392804097;
const TILE_PX = 256;

type MatrixLevel = {
  z: number;
  topLeftX: number;
  topLeftY: number;
  res: number;
  matrixWidth: number;
  matrixHeight: number;
};

/** Known GoogleMapsCompatible_BoM levels (from BoM WMTS capabilities). */
const FALLBACK_MATRICES: MatrixLevel[] = [
  { z: 0, topLeftX: 11584952, topLeftY: 34168990.685578, res: INITIAL_RES / 1, matrixWidth: 1, matrixHeight: 1 },
  { z: 1, topLeftX: 11584952, topLeftY: 14131482.342789, res: INITIAL_RES / 2, matrixWidth: 1, matrixHeight: 1 },
  { z: 2, topLeftX: 11584952, topLeftY: 4112728.171395, res: INITIAL_RES / 4, matrixWidth: 1, matrixHeight: 1 },
  { z: 3, topLeftX: 11584952, topLeftY: 4112728.171395, res: INITIAL_RES / 8, matrixWidth: 2, matrixHeight: 2 },
  { z: 4, topLeftX: 11584952, topLeftY: 1608039.628546, res: INITIAL_RES / 16, matrixWidth: 3, matrixHeight: 3 },
  { z: 5, topLeftX: 11584952, topLeftY: 355695.357122, res: INITIAL_RES / 32, matrixWidth: 6, matrixHeight: 5 },
  { z: 6, topLeftX: 11584952, topLeftY: -270476.778591, res: INITIAL_RES / 64, matrixWidth: 11, matrixHeight: 9 },
  { z: 7, topLeftX: 11584952, topLeftY: -583562.846447, res: INITIAL_RES / 128, matrixWidth: 22, matrixHeight: 17 },
  { z: 8, topLeftX: 11584952, topLeftY: -740105.880375, res: INITIAL_RES / 256, matrixWidth: 43, matrixHeight: 33 },
];

type CapsCache = {
  fetchedAt: number;
  times: string[];
  matrices: Map<number, MatrixLevel>;
};

let capsCache: CapsCache | null = null;
let capsInflight: Promise<CapsCache> | null = null;
const CAPS_TTL_MS = 60_000;

/** BoM rain-radar palette → approximate dBZ (exact RGBA hits). */
const BOM_COLOR_TO_DBZ: ReadonlyArray<{ rgba: readonly [number, number, number, number]; dbz: number }> = [
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

const BOM_RECOLOUR = new Map<number, number>();
for (const { rgba, dbz } of BOM_COLOR_TO_DBZ) {
  const [nr, ng, nb, na] = colourForDbz(dbz);
  BOM_RECOLOUR.set(
    pack(rgba[0], rgba[1], rgba[2], rgba[3]),
    pack(nr, ng, nb, na),
  );
}

function recolourBomPixel(
  r: number,
  g: number,
  b: number,
  a: number,
): number {
  if (a < 10) return 0;
  const hit = BOM_RECOLOUR.get(pack(r, g, b, a));
  if (hit != null) return hit;
  // Near-match for slight PNG quantisation (ignore alpha).
  let best = 0;
  let bestD = 48;
  for (const { rgba, dbz } of BOM_COLOR_TO_DBZ) {
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

function parseCaps(xml: string): CapsCache {
  const matrices = new Map<number, MatrixLevel>();
  // Prefer the GoogleMapsCompatible_BoM set; fall back to first TileMatrixSet.
  const tmsBlock =
    xml.match(
      /<TileMatrixSet>\s*<ows:Identifier>GoogleMapsCompatible_BoM<\/ows:Identifier>[\s\S]*?<\/TileMatrixSet>/,
    )?.[0] ??
    xml.match(/<TileMatrixSet>[\s\S]*?<\/TileMatrixSet>/)?.[0];
  if (tmsBlock) {
    const matrixRe =
      /<TileMatrix>\s*<ows:Identifier>(\d+)<\/ows:Identifier>\s*<ScaleDenominator>([0-9.]+)<\/ScaleDenominator>\s*<TopLeftCorner>\s*([-\d.]+)\s+([-\d.]+)\s*<\/TopLeftCorner>\s*<TileWidth>(\d+)<\/TileWidth>\s*<TileHeight>(\d+)<\/TileHeight>\s*<MatrixWidth>(\d+)<\/MatrixWidth>\s*<MatrixHeight>(\d+)<\/MatrixHeight>\s*<\/TileMatrix>/g;
    let m: RegExpExecArray | null;
    while ((m = matrixRe.exec(tmsBlock))) {
      const z = Number(m[1]);
      const scale = Number(m[2]);
      matrices.set(z, {
        z,
        topLeftX: Number(m[3]),
        topLeftY: Number(m[4]),
        res: scale * 0.00028,
        matrixWidth: Number(m[7]),
        matrixHeight: Number(m[8]),
      });
    }
  }

  // Layer block for reflectivity — non-greedy until its Dimension closes.
  const layerIdx = xml.indexOf(
    `<ows:Identifier>${BOM_RADAR_LAYER}</ows:Identifier>`,
  );
  const times: string[] = [];
  if (layerIdx >= 0) {
    const slice = xml.slice(Math.max(0, layerIdx - 64), layerIdx + 200_000);
    const dim = slice.match(
      /<Dimension>\s*<ows:Identifier>time<\/ows:Identifier>[\s\S]*?<\/Dimension>/,
    )?.[0];
    if (dim) {
      for (const v of dim.matchAll(
        /<Value>(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)<\/Value>/g,
      )) {
        times.push(v[1]!);
      }
    }
  }
  if (matrices.size === 0) {
    for (const level of FALLBACK_MATRICES) matrices.set(level.z, level);
  }
  times.sort();
  return { fetchedAt: Date.now(), times, matrices };
}

export async function getBomRadarCapabilities(): Promise<CapsCache> {
  if (capsCache && Date.now() - capsCache.fetchedAt < CAPS_TTL_MS) {
    return capsCache;
  }
  if (capsInflight) return capsInflight;
  capsInflight = (async () => {
    try {
      const res = await fetch(CAPS_URL, {
        headers: bomHeaders("application/xml,text/xml,*/*"),
        signal: AbortSignal.timeout(12_000),
      });
      const xml = await res.text();
      if (!res.ok || !xml.includes("Capabilities")) {
        throw new Error(`BoM caps HTTP ${res.status}`);
      }
      capsCache = parseCaps(xml);
      return capsCache;
    } catch (err) {
      console.error("[bom-radar] capabilities failed", err);
      if (capsCache) return capsCache;
      const matrices = new Map<number, MatrixLevel>();
      for (const level of FALLBACK_MATRICES) matrices.set(level.z, level);
      return { fetchedAt: Date.now(), times: [], matrices };
    } finally {
      capsInflight = null;
    }
  })();
  return capsInflight;
}

/** Unix seconds for available BoM reflectivity frames. */
export async function getBomRadarFrameTimes(): Promise<number[]> {
  const caps = await getBomRadarCapabilities();
  return caps.times
    .map((t) => Math.floor(Date.parse(t) / 1000))
    .filter((n) => Number.isFinite(n));
}

export function bomRadarTileUrl(isoTime: string): string {
  const q = new URLSearchParams({
    source: "bom",
    time: isoTime,
  });
  return `/api/weather/radar-tile?${q.toString()}&z={z}&x={x}&y={y}`;
}

function xyzBounds(z: number, x: number, y: number) {
  const res = INITIAL_RES / 2 ** z;
  const span = res * TILE_PX;
  return {
    west: ORIGIN + x * span,
    east: ORIGIN + (x + 1) * span,
    north: -ORIGIN - y * span,
    south: -ORIGIN - (y + 1) * span,
    res,
    span,
  };
}

function bomTileUrl(time: string, z: number, row: number, col: number): string {
  const q = new URLSearchParams({
    SERVICE: "WMTS",
    VERSION: "1.0.0",
    REQUEST: "GetTile",
    LAYER: BOM_RADAR_LAYER,
    STYLE: "default",
    FORMAT: "image/png",
    TILEMATRIXSET: BOM_RADAR_TMS,
    TILEMATRIX: String(z),
    TILEROW: String(row),
    TILECOL: String(col),
    TIME: time,
  });
  return `${WMTS_KVP}?${q.toString()}`;
}

async function fetchBomTilePng(
  time: string,
  z: number,
  row: number,
  col: number,
): Promise<PNG | null> {
  try {
    const res = await fetch(bomTileUrl(time, z, row, col), {
      headers: bomHeaders("image/png,*/*"),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32 || buf[0] !== 0x89) return null;
    return PNG.sync.read(buf);
  } catch {
    return null;
  }
}

type SrcTile = {
  png: PNG;
  west: number;
  north: number;
  res: number;
};

function sampleSrc(
  tiles: SrcTile[],
  mx: number,
  my: number,
): [number, number, number, number] {
  for (const t of tiles) {
    const sx = (mx - t.west) / t.res;
    const sy = (t.north - my) / t.res;
    if (sx < -0.5 || sy < -0.5 || sx >= t.png.width + 0.5 || sy >= t.png.height + 0.5) {
      continue;
    }
    const x0 = Math.max(0, Math.min(t.png.width - 1, Math.floor(sx)));
    const y0 = Math.max(0, Math.min(t.png.height - 1, Math.floor(sy)));
    const x1 = Math.max(0, Math.min(t.png.width - 1, x0 + 1));
    const y1 = Math.max(0, Math.min(t.png.height - 1, y0 + 1));
    const fx = Math.min(1, Math.max(0, sx - x0));
    const fy = Math.min(1, Math.max(0, sy - y0));
    const idx = (yy: number, xx: number) => (yy * t.png.width + xx) << 2;
    const i00 = idx(y0, x0);
    const i10 = idx(y0, x1);
    const i01 = idx(y1, x0);
    const i11 = idx(y1, x1);
    const d = t.png.data;
    const a00 = d[i00 + 3]!;
    const a10 = d[i10 + 3]!;
    const a01 = d[i01 + 3]!;
    const a11 = d[i11 + 3]!;
    // Prefer opaque neighbours — avoid bleeding transparent into rain edges.
    const w00 = (1 - fx) * (1 - fy) * (a00 > 10 ? 1 : 0.05);
    const w10 = fx * (1 - fy) * (a10 > 10 ? 1 : 0.05);
    const w01 = (1 - fx) * fy * (a01 > 10 ? 1 : 0.05);
    const w11 = fx * fy * (a11 > 10 ? 1 : 0.05);
    const wsum = w00 + w10 + w01 + w11;
    if (wsum < 1e-6) return [0, 0, 0, 0];
    const r =
      (d[i00]! * w00 + d[i10]! * w10 + d[i01]! * w01 + d[i11]! * w11) / wsum;
    const g =
      (d[i00 + 1]! * w00 +
        d[i10 + 1]! * w10 +
        d[i01 + 1]! * w01 +
        d[i11 + 1]! * w11) /
      wsum;
    const b =
      (d[i00 + 2]! * w00 +
        d[i10 + 2]! * w10 +
        d[i01 + 2]! * w01 +
        d[i11 + 2]! * w11) /
      wsum;
    const a =
      (a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11) / wsum;
    return [
      Math.round(r),
      Math.round(g),
      Math.round(b),
      Math.round(a),
    ];
  }
  return [0, 0, 0, 0];
}

/**
 * Render a standard Leaflet XYZ tile from BoM WMTS source tiles.
 * `time` is ISO-8601 UTC (e.g. 2026-10-06T12:00:00Z).
 */
export async function renderBomRadarXyzTile(
  time: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer> {
  const caps = await getBomRadarCapabilities();
  const fetchZ = Math.min(z, BOM_RADAR_NATIVE_MAX_ZOOM);
  const matrix =
    caps.matrices.get(fetchZ) ??
    FALLBACK_MATRICES.find((m) => m.z === fetchZ) ??
    null;
  if (!matrix) {
    return transparentRadarTilePng();
  }

  // Snap time to a known slot when close; otherwise use as-is.
  let useTime = time;
  if (caps.times.length > 0 && !caps.times.includes(time)) {
    const target = Date.parse(time);
    let best = caps.times[caps.times.length - 1]!;
    let bestD = Infinity;
    for (const t of caps.times) {
      const d = Math.abs(Date.parse(t) - target);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    useTime = best;
  }

  const bounds = xyzBounds(z, x, y);
  const tileSpan = matrix.res * TILE_PX;

  // Parent covering area when overzooming: use XYZ parent at fetchZ.
  const scale = 2 ** (z - fetchZ);
  const parentX = scale > 1 ? Math.floor(x / scale) : x;
  const parentY = scale > 1 ? Math.floor(y / scale) : y;
  const parentBounds = xyzBounds(fetchZ, parentX, parentY);

  const sampleWest = scale > 1 ? parentBounds.west : bounds.west;
  const sampleEast = scale > 1 ? parentBounds.east : bounds.east;
  const sampleNorth = scale > 1 ? parentBounds.north : bounds.north;
  const sampleSouth = scale > 1 ? parentBounds.south : bounds.south;

  const col0 = Math.floor((sampleWest - matrix.topLeftX) / tileSpan) - 1;
  const col1 = Math.floor((sampleEast - matrix.topLeftX) / tileSpan) + 1;
  const row0 = Math.floor((matrix.topLeftY - sampleNorth) / tileSpan) - 1;
  const row1 = Math.floor((matrix.topLeftY - sampleSouth) / tileSpan) + 1;

  const jobs: Promise<SrcTile | null>[] = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      if (col < 0 || row < 0 || col >= matrix.matrixWidth || row >= matrix.matrixHeight) {
        continue;
      }
      jobs.push(
        (async () => {
          const png = await fetchBomTilePng(useTime, fetchZ, row, col);
          if (!png) return null;
          return {
            png,
            west: matrix.topLeftX + col * tileSpan,
            north: matrix.topLeftY - row * tileSpan,
            res: matrix.res,
          };
        })(),
      );
    }
  }

  const tiles = (await Promise.all(jobs)).filter((t): t is SrcTile => t != null);
  if (!tiles.length) return transparentRadarTilePng();

  const out = new PNG({ width: TILE_PX, height: TILE_PX });
  const outRes = bounds.res;
  for (let py = 0; py < TILE_PX; py++) {
    const my = bounds.north - (py + 0.5) * outRes;
    for (let px = 0; px < TILE_PX; px++) {
      const mx = bounds.west + (px + 0.5) * outRes;
      const [r, g, b, a] = sampleSrc(tiles, mx, my);
      const packed = recolourBomPixel(r, g, b, a);
      const i = (py * TILE_PX + px) << 2;
      if (packed === 0) {
        out.data[i] = 0;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 0;
      } else {
        out.data[i] = (packed >>> 24) & 255;
        out.data[i + 1] = (packed >>> 16) & 255;
        out.data[i + 2] = (packed >>> 8) & 255;
        out.data[i + 3] = packed & 255;
      }
    }
  }
  return PNG.sync.write(out);
}

export function isoTimeFromUnix(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
