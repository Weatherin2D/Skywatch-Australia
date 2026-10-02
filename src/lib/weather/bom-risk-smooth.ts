/**
 * Smooth BoM-style risk regions from sparse forecast samples (contours, not grid squares).
 */

import type { DisplayFeature, GeoJsonGeometry } from "@/lib/forecast/types";
import type { BomRiskCategoryId } from "@/lib/weather/bom-thunderstorm";

const AU = {
  minLat: -43.8,
  maxLat: -9.2,
  minLon: 112.8,
  maxLon: 154.2,
  step: 0.22,
};

const INFLUENCE_SIGMA_KM = 210;
const INFLUENCE_CUTOFF_SIGMA = 2.4;

const RANK_BY_ID: Record<BomRiskCategoryId, number> = {
  tstm_possible: 1,
  tstm_likely: 2,
  severe_possible: 3,
  severe_likely: 4,
};

const ID_BY_RANK: Record<number, BomRiskCategoryId> = {
  1: "tstm_possible",
  2: "tstm_likely",
  3: "severe_possible",
  4: "severe_likely",
};

export type RiskSamplePoint = {
  lat: number;
  lon: number;
  rank: number;
};

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function gridSize() {
  const cols = Math.ceil((AU.maxLon - AU.minLon) / AU.step) + 1;
  const rows = Math.ceil((AU.maxLat - AU.minLat) / AU.step) + 1;
  return { rows, cols };
}

function nodeLatLon(row: number, col: number) {
  const lat = AU.maxLat - row * AU.step;
  const lon = AU.minLon + col * AU.step;
  return { lat, lon };
}

function buildRankField(points: RiskSamplePoint[]): Float32Array {
  const { rows, cols } = gridSize();
  const field = new Float32Array(rows * cols);
  const maxDist = INFLUENCE_SIGMA_KM * INFLUENCE_CUTOFF_SIGMA;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { lat, lon } = nodeLatLon(row, col);
      let best = 0;
      for (const p of points) {
        const d = haversineKm(lat, lon, p.lat, p.lon);
        if (d > maxDist) continue;
        const w = Math.exp(-(d * d) / (2 * INFLUENCE_SIGMA_KM * INFLUENCE_SIGMA_KM));
        if (w < 0.08) continue;
        // Soft max — higher ranks dominate when influence overlaps.
        const score = p.rank * w + (w > 0.45 ? p.rank * 0.35 : 0);
        if (score > best) best = score;
      }
      field[row * cols + col] = best;
    }
  }

  blurAndQuantize(field, rows, cols);
  return field;
}

function blurAndQuantize(field: Float32Array, rows: number, cols: number) {
  for (let pass = 0; pass < 2; pass++) {
    const src = Float32Array.from(field);
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        let sum = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            sum += src[(row + dr) * cols + (col + dc)]!;
          }
        }
        field[row * cols + col] = sum / 9;
      }
    }
  }

  for (let i = 0; i < field.length; i++) {
    const v = field[i]!;
    if (v < 0.42) field[i] = 0;
    else if (v < 1.35) field[i] = 1;
    else if (v < 2.35) field[i] = 2;
    else if (v < 3.35) field[i] = 3;
    else field[i] = 4;
  }
}

function nodeValue(
  field: Float32Array,
  rows: number,
  cols: number,
  row: number,
  col: number,
): number {
  if (row < 0 || col < 0 || row >= rows || col >= cols) return 0;
  return field[row * cols + col]!;
}

/** Marching squares contours for cells where value >= threshold. */
function contourPolygons(
  field: Float32Array,
  threshold: number,
): number[][][] {
  const { rows, cols } = gridSize();
  const segments: Array<[[number, number], [number, number]]> = [];

  const interp = (
    row: number,
    col: number,
    v0: number,
    v1: number,
    horizontal: boolean,
  ): [number, number] => {
    const t = v0 === v1 ? 0.5 : (threshold - v0) / (v1 - v0);
    const clamped = Math.max(0, Math.min(1, t));
    if (horizontal) {
      const lat = AU.maxLat - row * AU.step;
      const lon = AU.minLon + (col + clamped) * AU.step;
      return [lon, lat];
    }
    const lat = AU.maxLat - (row + clamped) * AU.step;
    const lon = AU.minLon + col * AU.step;
    return [lon, lat];
  };

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const tl = nodeValue(field, rows, cols, row, col);
      const tr = nodeValue(field, rows, cols, row, col + 1);
      const bl = nodeValue(field, rows, cols, row + 1, col);
      const br = nodeValue(field, rows, cols, row + 1, col + 1);
      const vTL = tl >= threshold ? 1 : 0;
      const vTR = tr >= threshold ? 1 : 0;
      const vBL = bl >= threshold ? 1 : 0;
      const vBR = br >= threshold ? 1 : 0;
      const caseId = vTL | (vTR << 1) | (vBR << 2) | (vBL << 3);
      if (caseId === 0 || caseId === 15) continue;

      const top = interp(row, col, tl, tr, true);
      const right = interp(row, col + 1, tr, br, false);
      const bottom = interp(row + 1, col, bl, br, true);
      const left = interp(row, col, tl, bl, false);

      switch (caseId) {
        case 1:
        case 14:
          segments.push([left, bottom]);
          break;
        case 2:
        case 13:
          segments.push([bottom, right]);
          break;
        case 3:
        case 12:
          segments.push([left, right]);
          break;
        case 4:
        case 11:
          segments.push([top, right]);
          break;
        case 5:
          segments.push([left, top]);
          segments.push([bottom, right]);
          break;
        case 6:
        case 9:
          segments.push([top, bottom]);
          break;
        case 7:
        case 8:
          segments.push([left, top]);
          break;
        case 10:
          segments.push([left, bottom]);
          segments.push([top, right]);
          break;
        default:
          break;
      }
    }
  }

  return stitchSegments(segments);
}

function stitchSegments(
  segments: Array<[[number, number], [number, number]]>,
): number[][][] {
  if (!segments.length) return [];
  const key = (p: [number, number]) =>
    `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const adj = new Map<string, Array<[number, number]>>();

  for (const [a, b] of segments) {
    const ka = key(a);
    const kb = key(b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(b);
    adj.get(kb)!.push(a);
  }

  const rings: number[][][] = [];
  const used = new Set<string>();

  for (const [startKey] of adj) {
    if (used.has(startKey)) continue;
    const startParts = startKey.split(",").map(Number) as [number, number];
    const ring: number[][] = [[startParts[0], startParts[1]]];
    used.add(startKey);
    let current = startParts;
    let guard = 0;

    while (guard++ < 8000) {
      const neighbors = adj.get(key(current));
      if (!neighbors?.length) break;
      let next: [number, number] | null = null;
      for (const n of neighbors) {
        const nk = key(n);
        if (!used.has(nk) || (ring.length > 2 && nk === startKey)) {
          next = n;
          break;
        }
      }
      if (!next) break;
      const nk = key(next);
      if (nk === startKey && ring.length > 3) {
        ring.push([startParts[0], startParts[1]]);
        break;
      }
      ring.push([next[0], next[1]]);
      used.add(nk);
      current = next;
    }

    if (ring.length >= 4) rings.push(smoothRing(ring));
  }

  return rings.filter((r) => ringArea(r) > 0.08);
}

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return Math.abs(a / 2);
}

function smoothRing(ring: number[][]): number[][] {
  let out = ring.slice();
  for (let pass = 0; pass < 3; pass++) {
    const next: number[][] = [];
    const n = out.length - 1;
    for (let i = 0; i < n; i++) {
      const p0 = out[i]!;
      const p1 = out[i + 1]!;
      next.push([
        0.75 * p0[0]! + 0.25 * p1[0]!,
        0.75 * p0[1]! + 0.25 * p1[1]!,
      ]);
      next.push([
        0.25 * p0[0]! + 0.75 * p1[0]!,
        0.25 * p0[1]! + 0.75 * p1[1]!,
      ]);
    }
    next.push([next[0]![0]!, next[0]![1]!]);
    out = simplifyRing(next, 0.045);
  }
  return out;
}

function simplifyRing(ring: number[][], epsilon: number): number[][] {
  if (ring.length <= 4) return ring;
  const keep = douglasPeucker(ring.slice(0, -1), epsilon);
  keep.push([keep[0]![0]!, keep[0]![1]!]);
  return keep;
}

function douglasPeucker(points: number[][], epsilon: number): number[][] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let idx = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDist(points[i]!, points[0]!, points[end]!);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, idx + 1), epsilon);
    const right = douglasPeucker(points.slice(idx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0]!, points[end]!];
}

function perpDist(p: number[], a: number[], b: number[]): number {
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p[0]! - dx * p[1]! + b[0]! * a[1]! - b[1]! * a[0]!) / len;
}

function ringsToGeometry(rings: number[][][]): GeoJsonGeometry | null {
  if (!rings.length) return null;
  if (rings.length === 1) {
    return { type: "Polygon", coordinates: [rings[0]!] };
  }
  return {
    type: "MultiPolygon",
    coordinates: rings.map((r) => [r]),
  };
}

export function buildSmoothRiskFeatures(opts: {
  day: number;
  points: RiskSamplePoint[];
  categoryLabel: Record<BomRiskCategoryId, string>;
  categoryOrder: Record<BomRiskCategoryId, number>;
  styleFor: (id: BomRiskCategoryId) => DisplayFeature["style"];
}): DisplayFeature[] {
  const { day, points, categoryLabel, categoryOrder, styleFor } = opts;
  if (!points.length) return [];

  const field = buildRankField(points);
  const features: DisplayFeature[] = [];

  for (let rank = 1; rank <= 4; rank++) {
    const rings = contourPolygons(field, rank);
    const geometry = ringsToGeometry(rings);
    if (!geometry) continue;
    const id = ID_BY_RANK[rank]!;
    features.push({
      id: `bom-smooth-d${day}-${id}`,
      geometry,
      title: categoryLabel[id],
      categoryId: id,
      order: categoryOrder[id],
      style: styleFor(id),
    });
  }

  features.sort((a, b) => a.order - b.order);
  return features;
}
