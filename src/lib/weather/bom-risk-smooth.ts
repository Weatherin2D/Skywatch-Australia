/**
 * Smooth BoM-style risk regions from sparse forecast samples.
 *
 * Renders a georeferenced PNG of nested carved risk bands (not town squares
 * or overlapping circles). The soft influence field is blurred, quantized to
 * the 4 BoM categories, then painted as continuous filled regions.
 */

import { PNG } from "pngjs";

/** Geographic frame of the risk raster (Leaflet ImageOverlay bounds). */
export const BOM_RISK_IMAGE_BOUNDS: [[number, number], [number, number]] = [
  [-44.0, 112.5], // SW
  [-9.5, 154.5], // NE
];

const AU = {
  minLat: BOM_RISK_IMAGE_BOUNDS[0][0],
  maxLat: BOM_RISK_IMAGE_BOUNDS[1][0],
  minLon: BOM_RISK_IMAGE_BOUNDS[0][1],
  maxLon: BOM_RISK_IMAGE_BOUNDS[1][1],
};

/** Working raster size (upscaled for the final PNG). */
const WORK_WIDTH = 360;
const OUT_WIDTH = 720;
const SIGMA_KM = 270;
const CUTOFF_SIGMA = 2.5;

const COLOR_BY_RANK: Record<number, [number, number, number, number]> = {
  1: [46, 125, 50, 150], // Thunderstorms possible
  2: [174, 213, 129, 165], // Thunderstorms likely
  3: [249, 168, 37, 175], // Severe possible
  4: [198, 40, 40, 185], // Severe likely
};

export type RiskSamplePoint = {
  lat: number;
  lon: number;
  rank: number;
};

/** Fast equirectangular distance — good enough for influence kernels. */
function approxKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat1 - lat2) * 111.0;
  const dLon =
    (lon1 - lon2) * 111.0 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

function sizeFor(width: number) {
  const aspect =
    (AU.maxLon - AU.minLon) / Math.max(0.01, AU.maxLat - AU.minLat);
  const height = Math.max(180, Math.round(width / aspect));
  return { width, height };
}

function pixelToLatLon(x: number, y: number, width: number, height: number) {
  const lon = AU.minLon + ((x + 0.5) / width) * (AU.maxLon - AU.minLon);
  const lat = AU.maxLat - ((y + 0.5) / height) * (AU.maxLat - AU.minLat);
  return { lat, lon };
}

function buildSoftField(
  points: RiskSamplePoint[],
  width: number,
  height: number,
): Float32Array {
  const soft = new Float32Array(width * height);
  if (!points.length) return soft;

  const maxDist = SIGMA_KM * CUTOFF_SIGMA;
  const twoSigma2 = 2 * SIGMA_KM * SIGMA_KM;
  // Degree cutoff box for cheap reject before distance calc.
  const degPad = maxDist / 90;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { lat, lon } = pixelToLatLon(x, y, width, height);
      let best = 0;
      for (const p of points) {
        if (Math.abs(p.lat - lat) > degPad || Math.abs(p.lon - lon) > degPad) {
          continue;
        }
        const d = approxKm(lat, lon, p.lat, p.lon);
        if (d > maxDist) continue;
        const w = Math.exp(-(d * d) / twoSigma2);
        const score = p.rank * (0.45 + 0.55 * w) * Math.min(1, w / 0.09);
        if (score > best) best = score;
      }
      soft[y * width + x] = best;
    }
  }

  // Blur → continuous carved bands instead of town-centered blobs.
  for (let pass = 0; pass < 4; pass++) {
    const src = Float32Array.from(soft);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += src[(y + dy) * width + (x + dx)]!;
          }
        }
        soft[y * width + x] = sum / 9;
      }
    }
  }

  return soft;
}

function quantizeField(
  soft: Float32Array,
  width: number,
  height: number,
): Uint8Array {
  const field = new Uint8Array(soft.length);
  for (let i = 0; i < soft.length; i++) {
    const v = soft[i]!;
    if (v < 0.48) field[i] = 0;
    else if (v < 1.35) field[i] = 1;
    else if (v < 2.3) field[i] = 2;
    else if (v < 3.25) field[i] = 3;
    else field[i] = 4;
  }

  // Majority fill closes one-pixel holes between towns.
  for (let pass = 0; pass < 3; pass++) {
    const src = Uint8Array.from(field);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const counts = [0, 0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            counts[src[(y + dy) * width + (x + dx)]!]!++;
          }
        }
        let maj = 0;
        let majN = 0;
        for (let r = 1; r <= 4; r++) {
          if (counts[r]! > majN) {
            majN = counts[r]!;
            maj = r;
          }
        }
        const i = y * width + x;
        if (majN >= 5 && field[i]! < maj) field[i] = maj;
      }
    }
  }

  return field;
}

function upsampleNearest(
  field: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      out[y * dstW + x] = field[sy * srcW + sx]!;
    }
  }
  return out;
}

/** Georeferenced PNG of nested BoM risk bands for Leaflet ImageOverlay. */
export function renderBomRiskPng(points: RiskSamplePoint[]): Buffer {
  const work = sizeFor(WORK_WIDTH);
  const out = sizeFor(OUT_WIDTH);
  const soft = buildSoftField(points, work.width, work.height);
  const workField = quantizeField(soft, work.width, work.height);
  const field = upsampleNearest(
    workField,
    work.width,
    work.height,
    out.width,
    out.height,
  );
  const { width, height } = out;
  const png = new PNG({ width, height });

  for (let i = 0; i < field.length; i++) {
    const rank = field[i]!;
    const o = i * 4;
    if (!rank) {
      png.data[o] = 0;
      png.data[o + 1] = 0;
      png.data[o + 2] = 0;
      png.data[o + 3] = 0;
      continue;
    }
    const [r, g, b, a] = COLOR_BY_RANK[rank]!;
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = a;
  }

  // Soft outer edge: fade alpha where rank meets empty (carved look).
  const srcA = Buffer.from(png.data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (field[i] === 0) continue;
      let empty = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (field[(y + dy) * width + (x + dx)] === 0) empty++;
        }
      }
      if (empty > 0) {
        const o = i * 4;
        const fade = Math.max(0.35, 1 - empty / 10);
        png.data[o + 3] = Math.round(srcA[o + 3]! * fade);
      }
    }
  }

  return PNG.sync.write(png);
}
