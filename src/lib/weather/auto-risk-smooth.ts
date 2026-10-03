/**
 * Smooth automated risk raster: nested carved colour bands + L1/L2 hatches.
 * Tuned for TV-style organic corridors (large outer envelope, nested cores).
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

const WORK_WIDTH = 420;
const OUT_WIDTH = 1400;
/** Large kernel merges samples into continuous frontal-style corridors. */
const SIGMA_KM = 320;
const CUTOFF_SIGMA = 2.45;
/** Softer long-range fill so outer bands knit into one envelope. */
const FILL_SIGMA_KM = 520;
const FILL_CUTOFF = 2.1;

const COLOR_BY_RANK: Record<number, [number, number, number, number]> = {};
for (const c of AUTO_RISK_CATEGORIES) {
  COLOR_BY_RANK[c.rank] = c.rgba;
}

export type AutoRiskSamplePoint = {
  lat: number;
  lon: number;
  rank: number;
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

function splatField(
  points: AutoRiskSamplePoint[],
  width: number,
  height: number,
  pick: (p: AutoRiskSamplePoint) => number,
  sigmaKm: number,
  cutoffSigma: number,
  mode: "max" | "blend",
): Float32Array {
  const soft = new Float32Array(width * height);
  const weight = mode === "blend" ? new Float32Array(width * height) : null;
  if (!points.length) return soft;

  const maxDist = sigmaKm * cutoffSigma;
  const twoSigma2 = 2 * sigmaKm * sigmaKm;
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
        const i = y * width + x;
        if (mode === "max") {
          const score = value * (0.42 + 0.58 * w) * Math.min(1, w / 0.07);
          if (score > soft[i]!) soft[i] = score;
        } else {
          soft[i]! += value * w;
          weight![i]! += w;
        }
      }
    }
  }

  if (weight) {
    for (let i = 0; i < soft.length; i++) {
      if (weight[i]! > 1e-6) soft[i] = soft[i]! / weight[i]!;
      else soft[i] = 0;
    }
  }

  return soft;
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

/** Max cores + blended fill → continuous nested corridors (TV outlook look). */
function buildSoftField(
  points: AutoRiskSamplePoint[],
  width: number,
  height: number,
  pick: (p: AutoRiskSamplePoint) => number,
): Float32Array {
  const cores = splatField(
    points,
    width,
    height,
    pick,
    SIGMA_KM,
    CUTOFF_SIGMA,
    "max",
  );
  const fill = splatField(
    points,
    width,
    height,
    pick,
    FILL_SIGMA_KM,
    FILL_CUTOFF,
    "blend",
  );
  const soft = new Float32Array(width * height);
  for (let i = 0; i < soft.length; i++) {
    soft[i] = Math.max(cores[i]!, fill[i]! * 0.85);
  }
  blurField(soft, width, height, 5);
  return soft;
}

/**
 * Nested band quantize — higher ranks carve inside lower envelopes
 * (green outside → yellow → orange → red cores), not round-to-nearest blobs.
 */
function quantizeRankField(soft: Float32Array, maxRank: number): Uint8Array {
  const field = new Uint8Array(soft.length);
  // Threshold ladder for ranks 1…8 — upper bands need strong cores.
  const thresholds = [0.42, 1.1, 1.85, 2.7, 3.65, 4.7, 5.9, 7.2];
  for (let i = 0; i < soft.length; i++) {
    const v = soft[i]!;
    let rank = 0;
    for (let r = maxRank; r >= 1; r--) {
      if (v >= thresholds[r - 1]!) {
        rank = r;
        break;
      }
    }
    field[i] = rank;
  }
  return field;
}

function quantizeHatchField(soft: Float32Array): Uint8Array {
  const field = new Uint8Array(soft.length);
  for (let i = 0; i < soft.length; i++) {
    const v = soft[i]!;
    if (v < 0.7) field[i] = 0;
    else if (v < 1.55) field[i] = 1;
    else field[i] = 2;
  }
  return field;
}

/** Close interior holes so bands read as solid nested polygons. */
function closeRankHoles(
  field: Uint8Array,
  width: number,
  height: number,
  passes: number,
) {
  for (let pass = 0; pass < passes; pass++) {
    const src = Uint8Array.from(field);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (src[i]! !== 0) continue;
        const counts = new Array(AUTO_RISK_MAX_RANK + 1).fill(0) as number[];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            counts[src[(y + dy) * width + (x + dx)]!]!++;
          }
        }
        let maj = 0;
        let majN = 0;
        for (let r = 1; r <= AUTO_RISK_MAX_RANK; r++) {
          if (counts[r]! > majN) {
            majN = counts[r]!;
            maj = r;
          }
        }
        if (majN >= 6) field[i] = maj;
      }
    }
  }
}

/** Soften staircase edges with a majority filter (keep nested structure). */
function majoritySmooth(
  field: Uint8Array,
  width: number,
  height: number,
  passes: number,
) {
  for (let pass = 0; pass < passes; pass++) {
    const src = Uint8Array.from(field);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (src[i]! === 0) continue;
        const counts = new Array(AUTO_RISK_MAX_RANK + 1).fill(0) as number[];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            counts[src[(y + dy) * width + (x + dx)]!]!++;
          }
        }
        let maj = src[i]!;
        let majN = 0;
        for (let r = 1; r <= AUTO_RISK_MAX_RANK; r++) {
          if (counts[r]! > majN) {
            majN = counts[r]!;
            maj = r;
          }
        }
        // Prefer keeping or stepping down one band — avoids speckles.
        if (majN >= 5) {
          field[i] = maj > src[i]! ? src[i]! : maj;
        }
      }
    }
  }
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
  blurField(rankSoft, out.width, out.height, 3);
  blurField(hatchSoft, out.width, out.height, 2);

  const ranks = quantizeRankField(rankSoft, AUTO_RISK_MAX_RANK);
  closeRankHoles(ranks, out.width, out.height, 2);
  majoritySmooth(ranks, out.width, out.height, 2);
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

  // Soft outer edge fade for organic TV-style boundaries.
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
          srcA[o + 3]! * Math.max(0.28, 1 - empty / 9),
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
