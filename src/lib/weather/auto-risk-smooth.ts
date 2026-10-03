/**
 * Automated risk raster: connect-the-dots nested bands + L1/L2 hatches.
 *
 * Sample points are stamped and morphologically closed so nearby sites join
 * into irregular corridors — not isotropic Gaussian circles.
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

const WORK_WIDTH = 780;
const OUT_WIDTH = 2400;
const OUTLINE_PX = 3;

/** Small stamp around each sample (~town footprint). */
const STAMP_KM = 34;
/**
 * Closing radius connects neighbouring samples into corridors.
 * Lower ranks close farther (outer envelope); higher ranks stay tighter.
 */
const CLOSE_KM_BY_RANK: Record<number, number> = {
  1: 145,
  2: 125,
  3: 110,
  4: 95,
  5: 85,
  6: 75,
  7: 65,
  8: 55,
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

/** Morphological closing: dilate then erode — bridges gaps between stamps. */
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

/**
 * Connect-the-dots rank field: for each rank, stamp samples at/above that
 * rank and close gaps so neighbouring sites form irregular polygons.
 */
function buildConnectedRankField(
  points: AutoRiskSamplePoint[],
  width: number,
  height: number,
): Uint8Array {
  const field = new Uint8Array(width * height);
  if (!points.length) return field;

  const kpp = kmPerPixel(width, height);
  const stampR = Math.max(2, STAMP_KM / kpp);

  // Low → high so higher ranks overwrite nested cores.
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

    const closeKm = CLOSE_KM_BY_RANK[rank] ?? 80;
    const closeR = Math.max(2, Math.round(closeKm / kpp));
    const closed = closeMask(mask, width, height, closeR);

    for (let i = 0; i < field.length; i++) {
      if (closed[i]) field[i] = rank;
    }
  }

  // Drop tiny islands (unconnected single stamps) for a cleaner corridor look.
  pruneSmallComponents(field, width, height, 18);
  majoritySmooth(field, width, height, 2);
  return field;
}

/** Remove small connected components below minPixels (4-connected). */
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

function buildConnectedHatchField(
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
    const closeR = Math.max(2, Math.round((level === 2 ? 55 : 70) / kpp));
    const closed = closeMask(mask, width, height, closeR);
    for (let i = 0; i < field.length; i++) {
      if (closed[i]) field[i] = level;
    }
  }
  return field;
}

/** Nearest-neighbour upsample keeps faceted connect-the-dots edges. */
function upsampleNearest(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dstW));
      out[y * dstW + x] = src[sy * srcW + sx]!;
    }
  }
  return out;
}

/** Light majority filter — softens stair-steps without rounding into circles. */
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
        const counts = new Array(AUTO_RISK_MAX_RANK + 1).fill(0) as number[];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            counts[src[(y + dy) * width + (x + dx)]!]!++;
          }
        }
        let maj = src[i]!;
        let majN = counts[maj]!;
        for (let r = 0; r <= AUTO_RISK_MAX_RANK; r++) {
          if (counts[r]! > majN) {
            majN = counts[r]!;
            maj = r;
          }
        }
        if (majN >= 5) field[i] = maj;
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
      } else {
        const n = ranks[i - width]!;
        const s = ranks[i + width]!;
        const w = ranks[i - 1]!;
        const e = ranks[i + 1]!;
        if (n !== r || s !== r || w !== r || e !== r) border = true;
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

  const rankWork = buildConnectedRankField(points, work.width, work.height);
  const hatchWork = buildConnectedHatchField(points, work.width, work.height);

  const ranks = upsampleNearest(
    rankWork,
    work.width,
    work.height,
    out.width,
    out.height,
  );
  const hatches = upsampleNearest(
    hatchWork,
    work.width,
    work.height,
    out.width,
    out.height,
  );
  majoritySmooth(ranks, out.width, out.height, 2);

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
      if (ranks[i] === 0) continue;
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
