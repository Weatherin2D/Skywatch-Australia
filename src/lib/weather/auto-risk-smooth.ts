/**
 * Automated risk raster: connect-the-dots corridors with smoothed edges.
 *
 * 1) Stamp samples + morphological close (joins neighbours — not circles)
 * 2) Soft-blur / re-quantize so edges aren't stair-stepped fragments
 * 3) Black outlines on each band border
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

const WORK_WIDTH = 820;
const OUT_WIDTH = 2400;
const OUTLINE_PX = 3;

const STAMP_KM = 40;
/** Closing joins nearby samples into solid irregular corridors. */
const CLOSE_KM_BY_RANK: Record<number, number> = {
  1: 155,
  2: 135,
  3: 120,
  4: 105,
  5: 95,
  6: 85,
  7: 75,
  8: 65,
};

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

function kmPerPixel(width: number, height: number) {
  const kmPerPxX =
    ((AU.maxLon - AU.minLon) * 111.0 * Math.cos((-27 * Math.PI) / 180)) /
    width;
  const kmPerPxY = ((AU.maxLat - AU.minLat) * 111.0) / height;
  return Math.max(0.01, Math.min(kmPerPxX, kmPerPxY));
}

function dilate(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return Uint8Array.from(src);
  let cur = src;
  for (let pass = 0; pass < radius; pass++) {
    const next = Uint8Array.from(cur);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (cur[i]) continue;
        if (
          cur[i - 1] ||
          cur[i + 1] ||
          cur[i - width] ||
          cur[i + width] ||
          cur[i - width - 1] ||
          cur[i - width + 1] ||
          cur[i + width - 1] ||
          cur[i + width + 1]
        ) {
          next[i] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

function erode(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return Uint8Array.from(src);
  let cur = src;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(src.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!cur[i]) continue;
        if (
          cur[i - 1] &&
          cur[i + 1] &&
          cur[i - width] &&
          cur[i + width]
        ) {
          next[i] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

function closeMask(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return erode(dilate(src, width, height, radius), width, height, radius);
}

function stampDisk(
  mask: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number,
) {
  const r = Math.max(1, Math.round(radiusPx));
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) mask[y * width + x] = 1;
    }
  }
}

function pruneSmallComponents(
  field: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
) {
  const seen = new Uint8Array(field.length);
  const qx = new Int32Array(field.length);
  const qy = new Int32Array(field.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (!field[start] || seen[start]) continue;
      const rank = field[start]!;
      let qh = 0;
      let qt = 0;
      qx[qt] = x;
      qy[qt] = y;
      qt += 1;
      seen[start] = 1;
      const cells: number[] = [start];

      while (qh < qt) {
        const cx = qx[qh]!;
        const cy = qy[qh]!;
        qh += 1;
        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const;
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (seen[ni] || field[ni] !== rank) continue;
          seen[ni] = 1;
          qx[qt] = nx;
          qy[qt] = ny;
          qt += 1;
          cells.push(ni);
        }
      }

      if (cells.length < minPixels) {
        for (const i of cells) field[i] = 0;
      }
    }
  }
}

function blurFloat(
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

function quantizeFromSoft(soft: Float32Array, maxRank: number): Uint8Array {
  const field = new Uint8Array(soft.length);
  // Midpoints between integer ranks — blur softens stairs without circles.
  for (let i = 0; i < soft.length; i++) {
    const v = soft[i]!;
    if (v < 0.45) {
      field[i] = 0;
      continue;
    }
    let rank = Math.min(maxRank, Math.max(1, Math.round(v)));
    if (v < rank - 0.35 && rank > 1) rank -= 1;
    field[i] = rank;
  }
  return field;
}

/**
 * Connect-the-dots base field, then edge-smooth via blur/re-quantize.
 */
function buildRankField(
  points: AutoRiskSamplePoint[],
  width: number,
  height: number,
): Uint8Array {
  const field = new Uint8Array(width * height);
  if (!points.length) return field;

  const kpp = kmPerPixel(width, height);
  const stampR = Math.max(2, STAMP_KM / kpp);

  for (let rank = 1; rank <= AUTO_RISK_MAX_RANK; rank++) {
    const mask = new Uint8Array(width * height);
    let stamps = 0;
    for (const p of points) {
      if (p.rank < rank) continue;
      const { x, y } = latLonToPixel(p.lat, p.lon, width, height);
      stampDisk(mask, width, height, x, y, stampR);
      stamps += 1;
    }
    if (!stamps) continue;
    const closeKm = CLOSE_KM_BY_RANK[rank] ?? 90;
    const closeR = Math.max(3, Math.round(closeKm / kpp));
    const closed = closeMask(mask, width, height, closeR);
    for (let i = 0; i < field.length; i++) {
      if (closed[i]) field[i] = rank;
    }
  }

  pruneSmallComponents(field, width, height, 40);

  // Soften jagged morphological edges into continuous band borders.
  const soft = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) soft[i] = field[i]!;
  blurFloat(soft, width, height, 4);
  const smoothed = quantizeFromSoft(soft, AUTO_RISK_MAX_RANK);
  pruneSmallComponents(smoothed, width, height, 55);
  return smoothed;
}

function buildHatchField(
  points: AutoRiskSamplePoint[],
  width: number,
  height: number,
): Uint8Array {
  const field = new Uint8Array(width * height);
  if (!points.length) return field;
  const kpp = kmPerPixel(width, height);
  const stampR = Math.max(2, STAMP_KM / kpp);

  for (const level of [1, 2] as const) {
    const mask = new Uint8Array(width * height);
    let stamps = 0;
    for (const p of points) {
      if (p.hatch < level) continue;
      const { x, y } = latLonToPixel(p.lat, p.lon, width, height);
      stampDisk(mask, width, height, x, y, stampR);
      stamps += 1;
    }
    if (!stamps) continue;
    const closeR = Math.max(3, Math.round((level === 2 ? 60 : 80) / kpp));
    const closed = closeMask(mask, width, height, closeR);
    for (let i = 0; i < field.length; i++) {
      if (closed[i]) field[i] = level;
    }
  }

  const soft = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) soft[i] = field[i]!;
  blurFloat(soft, width, height, 3);
  const out = new Uint8Array(field.length);
  for (let i = 0; i < soft.length; i++) {
    const v = soft[i]!;
    if (v < 0.55) out[i] = 0;
    else if (v < 1.45) out[i] = 1;
    else out[i] = 2;
  }
  return out;
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
      ? (x + y) % 12 < 3 || (x - y + 4000) % 12 < 3
      : (x + y) % 11 < 2;
  if (!onStripe) return;
  const mix = kind === 2 ? 0.55 : 0.4;
  png.data[o] = Math.round(png.data[o]! * (1 - mix));
  png.data[o + 1] = Math.round(png.data[o + 1]! * (1 - mix));
  png.data[o + 2] = Math.round(png.data[o + 2]! * (1 - mix));
  png.data[o + 3] = Math.min(255, Math.round(png.data[o + 3]! * 1.05));
}

function paintRankOutlines(
  png: PNG,
  ranks: Uint8Array,
  width: number,
  height: number,
  thickness: number,
) {
  const edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = ranks[i]!;
      if (!r) continue;
      let border = false;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        border = true;
      } else if (
        ranks[i - width] !== r ||
        ranks[i + width] !== r ||
        ranks[i - 1] !== r ||
        ranks[i + 1] !== r
      ) {
        border = true;
      }
      if (border) edge[i] = 1;
    }
  }

  let mask = edge;
  for (let t = 1; t < thickness; t++) {
    const next = Uint8Array.from(mask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!ranks[i]) continue;
        if (
          mask[i] ||
          mask[i - 1] ||
          mask[i + 1] ||
          mask[i - width] ||
          mask[i + width]
        ) {
          next[i] = 1;
        }
      }
    }
    mask = next;
  }

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || !ranks[i]) continue;
    const o = i * 4;
    png.data[o] = 0;
    png.data[o + 1] = 0;
    png.data[o + 2] = 0;
    png.data[o + 3] = 255;
  }
}

/** Georeferenced PNG for Leaflet ImageOverlay. */
export function renderAutoRiskPng(points: AutoRiskSamplePoint[]): Buffer {
  const work = sizeFor(WORK_WIDTH);
  const out = sizeFor(OUT_WIDTH);

  const rankWork = buildRankField(points, work.width, work.height);
  const hatchWork = buildHatchField(points, work.width, work.height);

  const rankSoftWork = new Float32Array(rankWork.length);
  for (let i = 0; i < rankWork.length; i++) rankSoftWork[i] = rankWork[i]!;
  const hatchSoftWork = new Float32Array(hatchWork.length);
  for (let i = 0; i < hatchWork.length; i++) hatchSoftWork[i] = hatchWork[i]!;

  const rankSoft = upsampleBilinear(
    rankSoftWork,
    work.width,
    work.height,
    out.width,
    out.height,
  );
  const hatchSoft = upsampleBilinear(
    hatchSoftWork,
    work.width,
    work.height,
    out.width,
    out.height,
  );
  blurFloat(rankSoft, out.width, out.height, 2);
  blurFloat(hatchSoft, out.width, out.height, 1);

  const ranks = quantizeFromSoft(rankSoft, AUTO_RISK_MAX_RANK);
  pruneSmallComponents(ranks, out.width, out.height, 220);

  const hatches = new Uint8Array(hatchSoft.length);
  for (let i = 0; i < hatchSoft.length; i++) {
    const v = hatchSoft[i]!;
    if (v < 0.55) hatches[i] = 0;
    else if (v < 1.45) hatches[i] = 1;
    else hatches[i] = 2;
  }

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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!ranks[i]) continue;
      const h = hatches[i]!;
      if (h === 1 || h === 2) paintHatch(png, width, height, x, y, h);
    }
  }

  paintRankOutlines(png, ranks, width, height, OUTLINE_PX);
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
