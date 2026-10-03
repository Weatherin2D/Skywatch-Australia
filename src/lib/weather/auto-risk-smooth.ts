/**
 * Smooth automated risk raster: categorical colour bands + L1/L2 hatch overlays.
 * High-res splat renderer — dense samples stay fast on serverless.
 */

import { PNG } from "pngjs";
import {
  AUTO_RISK_CATEGORIES,
  AUTO_RISK_MAX_RANK,
  type AutoHatchId,
} from "@/lib/weather/auto-risk-categories";
import { BOM_RISK_IMAGE_BOUNDS } from "@/lib/weather/bom-risk-smooth";

export { BOM_RISK_IMAGE_BOUNDS as AUTO_RISK_IMAGE_BOUNDS };

const AU = {
  minLat: BOM_RISK_IMAGE_BOUNDS[0][0],
  maxLat: BOM_RISK_IMAGE_BOUNDS[1][0],
  minLon: BOM_RISK_IMAGE_BOUNDS[0][1],
  maxLon: BOM_RISK_IMAGE_BOUNDS[1][1],
};

/** Working field before upsample — high enough to hold fine structure. */
const WORK_WIDTH = 480;
/** Final Leaflet overlay resolution (~2× previous). */
const OUT_WIDTH = 1500;
/** Tighter kernel so dense samples resolve sharper risk cores. */
const SIGMA_KM = 155;
const CUTOFF_SIGMA = 2.3;

const COLOR_BY_RANK: Record<number, [number, number, number, number]> = {};
for (const c of AUTO_RISK_CATEGORIES) {
  COLOR_BY_RANK[c.rank] = c.rgba;
}

export type AutoRiskSamplePoint = {
  lat: number;
  lon: number;
  /** Categorical rank 0–8. */
  rank: number;
  /** Hatch overlay 0 / 1 (L1) / 2 (L2). */
  hatch: 0 | 1 | 2;
};

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

function latLonToPixel(
  lat: number,
  lon: number,
  width: number,
  height: number,
) {
  const x = ((lon - AU.minLon) / (AU.maxLon - AU.minLon)) * width - 0.5;
  const y = ((AU.maxLat - lat) / (AU.maxLat - AU.minLat)) * height - 0.5;
  return { x, y };
}

/**
 * Splat each sample as a Gaussian onto the work grid (max-blend).
 * O(points × kernel) — stays fast at high resolution with hundreds of sites.
 */
function buildSoftField(
  points: AutoRiskSamplePoint[],
  width: number,
  height: number,
  pick: (p: AutoRiskSamplePoint) => number,
): Float32Array {
  const soft = new Float32Array(width * height);
  if (!points.length) return soft;

  const maxDist = SIGMA_KM * CUTOFF_SIGMA;
  const twoSigma2 = 2 * SIGMA_KM * SIGMA_KM;
  const kmPerPxX =
    ((AU.maxLon - AU.minLon) * 111.0 * Math.cos((-27 * Math.PI) / 180)) /
    width;
  const kmPerPxY = ((AU.maxLat - AU.minLat) * 111.0) / height;
  const radiusPx = Math.ceil(
    maxDist / Math.max(0.01, Math.min(kmPerPxX, kmPerPxY)),
  );

  for (const p of points) {
    const value = pick(p);
    if (value <= 0) continue;
    const { x: cx, y: cy } = latLonToPixel(p.lat, p.lon, width, height);
    const x0 = Math.max(0, Math.floor(cx - radiusPx));
    const x1 = Math.min(width - 1, Math.ceil(cx + radiusPx));
    const y0 = Math.max(0, Math.floor(cy - radiusPx));
    const y1 = Math.min(height - 1, Math.ceil(cy + radiusPx));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const lon =
          AU.minLon + ((x + 0.5) / width) * (AU.maxLon - AU.minLon);
        const lat =
          AU.maxLat - ((y + 0.5) / height) * (AU.maxLat - AU.minLat);
        const d = approxKm(lat, lon, p.lat, p.lon);
        if (d > maxDist) continue;
        const w = Math.exp(-(d * d) / twoSigma2);
        const score = value * (0.45 + 0.55 * w) * Math.min(1, w / 0.09);
        const i = y * width + x;
        if (score > soft[i]!) soft[i] = score;
      }
    }
  }

  // Light blur to knit neighbouring samples into continuous bands.
  for (let pass = 0; pass < 2; pass++) {
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

function quantizeRankField(
  soft: Float32Array,
  maxRank: number,
): Uint8Array {
  const field = new Uint8Array(soft.length);
  for (let i = 0; i < soft.length; i++) {
    const v = soft[i]!;
    if (v < 0.4) {
      field[i] = 0;
      continue;
    }
    let rank = Math.min(maxRank, Math.max(1, Math.round(v)));
    if (v < rank - 0.32 && rank > 1) rank -= 1;
    field[i] = rank;
  }
  return field;
}

function quantizeHatchField(soft: Float32Array): Uint8Array {
  const field = new Uint8Array(soft.length);
  for (let i = 0; i < soft.length; i++) {
    const v = soft[i]!;
    if (v < 0.55) field[i] = 0;
    else if (v < 1.45) field[i] = 1;
    else field[i] = 2;
  }
  return field;
}

function upsampleBilinear(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const out = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const fy = ((y + 0.5) * srcH) / dstH - 0.5;
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(srcH - 1, y0 + 1));
    const ty = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < dstW; x++) {
      const fx = ((x + 0.5) * srcW) / dstW - 0.5;
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(fx)));
      const x1 = Math.max(0, Math.min(srcW - 1, x0 + 1));
      const tx = Math.max(0, Math.min(1, fx - x0));
      const v00 = src[y0 * srcW + x0]!;
      const v10 = src[y0 * srcW + x1]!;
      const v01 = src[y1 * srcW + x0]!;
      const v11 = src[y1 * srcW + x1]!;
      out[y * dstW + x] =
        (v00 * (1 - tx) + v10 * tx) * (1 - ty) +
        (v01 * (1 - tx) + v11 * tx) * ty;
    }
  }
  return out;
}

function blurField(
  soft: Float32Array,
  width: number,
  height: number,
  passes: number,
) {
  for (let pass = 0; pass < passes; pass++) {
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
}

function paintHatch(
  png: PNG,
  width: number,
  height: number,
  x: number,
  y: number,
  kind: 1 | 2,
) {
  const o = (y * width + x) * 4;
  const onStripe =
    kind === 2
      ? (x + y) % 10 < 3 || (x - y + 2000) % 10 < 3
      : (x + y) % 9 < 2;
  if (!onStripe) return;
  const mix = kind === 2 ? 0.55 : 0.4;
  png.data[o] = Math.round(png.data[o]! * (1 - mix));
  png.data[o + 1] = Math.round(png.data[o + 1]! * (1 - mix));
  png.data[o + 2] = Math.round(png.data[o + 2]! * (1 - mix));
  png.data[o + 3] = Math.min(255, Math.round(png.data[o + 3]! * 1.05));
}

/** Georeferenced PNG for Leaflet ImageOverlay. */
export function renderAutoRiskPng(points: AutoRiskSamplePoint[]): Buffer {
  const work = sizeFor(WORK_WIDTH);
  const out = sizeFor(OUT_WIDTH);

  const rankWork = buildSoftField(points, work.width, work.height, (p) => p.rank);
  const hatchWork = buildSoftField(
    points,
    work.width,
    work.height,
    (p) => p.hatch,
  );

  const rankSoft = upsampleBilinear(
    rankWork,
    work.width,
    work.height,
    out.width,
    out.height,
  );
  const hatchSoft = upsampleBilinear(
    hatchWork,
    work.width,
    work.height,
    out.width,
    out.height,
  );
  blurField(rankSoft, out.width, out.height, 1);
  blurField(hatchSoft, out.width, out.height, 1);

  const ranks = quantizeRankField(rankSoft, AUTO_RISK_MAX_RANK);
  const hatches = quantizeHatchField(hatchSoft);
  const { width, height } = out;
  const png = new PNG({ width, height });

  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i]!;
    const o = i * 4;
    if (!rank) {
      png.data[o] = 0;
      png.data[o + 1] = 0;
      png.data[o + 2] = 0;
      png.data[o + 3] = 0;
      continue;
    }
    const [r, g, b, a] = COLOR_BY_RANK[rank] ?? [120, 120, 120, 160];
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = a;
  }

  const srcA = Buffer.from(png.data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (ranks[i] === 0) continue;
      let empty = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (ranks[(y + dy) * width + (x + dx)] === 0) empty++;
        }
      }
      if (empty > 0) {
        const o = i * 4;
        png.data[o + 3] = Math.round(
          srcA[o + 3]! * Math.max(0.35, 1 - empty / 10),
        );
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (ranks[i] === 0) continue;
      const h = hatches[i]!;
      if (h === 1 || h === 2) paintHatch(png, width, height, x, y, h);
    }
  }

  return PNG.sync.write(png);
}

export function summarizeUsed(
  points: AutoRiskSamplePoint[],
): { ranks: Set<number>; hatches: Set<AutoHatchId> } {
  const ranks = new Set<number>();
  const hatches = new Set<AutoHatchId>();
  for (const p of points) {
    if (p.rank >= 1) ranks.add(p.rank);
    if (p.hatch === 1) hatches.add("l1");
    if (p.hatch === 2) hatches.add("l2");
  }
  return { ranks, hatches };
}
