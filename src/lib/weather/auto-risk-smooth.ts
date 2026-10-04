/**
 * Automated risk raster: compact Delaunay area bands.
 *
 * Sample sites with rank ≥ R are triangulated; only short, non-skinny
 * triangles are filled. Thin ribbon chaining is intentionally avoided
 * (it produced long “snake” corridors).
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

const WORK_WIDTH = 720;
const OUT_WIDTH = 2200;
const OUTLINE_PX = 2;

/** Max triangle edge (km). ~2–3 grid steps; longer spans look fake. */
const MAX_EDGE_KM = 185;
/** Reject skinny triangles (longest/shortest edge). Stops coastline “snakes”. */
const MAX_EDGE_RATIO = 2.45;
/** Morphological close after fill — knits triangle joints. */
const CLOSE_PX = 4;
/** Opening radius — strips thin ribbon snakes while keeping bulky areas. */
const OPEN_PX = 4;

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

type MeshPt = { x: number; y: number; lat: number; lon: number };

/* ---------- Bowyer–Watson Delaunay (2D) ---------- */

type Tri = [number, number, number];

function circumcircle(
  pts: MeshPt[],
  i: number,
  j: number,
  k: number,
): { x: number; y: number; r2: number } | null {
  const a = pts[i]!;
  const b = pts[j]!;
  const c = pts[k]!;
  const A = b.x - a.x;
  const B = b.y - a.y;
  const C = c.x - a.x;
  const D = c.y - a.y;
  const E = A * (a.x + b.x) + B * (a.y + b.y);
  const F = C * (a.x + c.x) + D * (a.y + c.y);
  const G = 2 * (A * (c.y - b.y) - B * (c.x - b.x));
  if (Math.abs(G) < 1e-10) return null;
  const x = (D * E - B * F) / G;
  const y = (A * F - C * E) / G;
  const dx = a.x - x;
  const dy = a.y - y;
  return { x, y, r2: dx * dx + dy * dy };
}

function delaunay(pts: MeshPt[]): Tri[] {
  const n = pts.length;
  if (n < 3) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const dmax = Math.max(dx, dy) * 10;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Super-triangle vertices appended temporarily
  const superA: MeshPt = {
    x: midX - 2 * dmax,
    y: midY - dmax,
    lat: 0,
    lon: 0,
  };
  const superB: MeshPt = {
    x: midX,
    y: midY + 2 * dmax,
    lat: 0,
    lon: 0,
  };
  const superC: MeshPt = {
    x: midX + 2 * dmax,
    y: midY - dmax,
    lat: 0,
    lon: 0,
  };
  const all = pts.concat([superA, superB, superC]);
  const sa = n;
  const sb = n + 1;
  const sc = n + 2;

  let tris: Tri[] = [[sa, sb, sc]];

  for (let i = 0; i < n; i++) {
    const p = all[i]!;
    const bad: Tri[] = [];
    for (const t of tris) {
      const cc = circumcircle(all, t[0], t[1], t[2]);
      if (!cc) {
        bad.push(t);
        continue;
      }
      const dxp = p.x - cc.x;
      const dyp = p.y - cc.y;
      if (dxp * dxp + dyp * dyp <= cc.r2 * (1 + 1e-10)) bad.push(t);
    }

    // Polygon hole boundary (edges that appear once)
    const edgeCount = new Map<string, [number, number]>();
    const edgeKey = (u: number, v: number) =>
      u < v ? `${u}|${v}` : `${v}|${u}`;
    for (const t of bad) {
      const edges: [number, number][] = [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ];
      for (const [u, v] of edges) {
        const k = edgeKey(u, v);
        if (edgeCount.has(k)) edgeCount.delete(k);
        else edgeCount.set(k, [u, v]);
      }
    }

    const badSet = new Set(bad);
    tris = tris.filter((t) => !badSet.has(t));
    for (const [u, v] of edgeCount.values()) {
      tris.push([u, v, i]);
    }
  }

  // Drop triangles touching the super-triangle
  return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}

/* ---------- Raster helpers ---------- */

function fillTriangle(
  mask: Uint8Array,
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
      const w1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const w2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
      if (
        (w0 >= 0 && w1 >= 0 && w2 >= 0) ||
        (w0 <= 0 && w1 <= 0 && w2 <= 0)
      ) {
        mask[y * width + x] = 1;
      }
    }
  }
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
        if (
          cur[i] &&
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
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const) {
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

function triangleOk(
  a: MeshPt,
  b: MeshPt,
  c: MeshPt,
  maxEdge: number,
): boolean {
  const eAB = approxKm(a.lat, a.lon, b.lat, b.lon);
  const eBC = approxKm(b.lat, b.lon, c.lat, c.lon);
  const eCA = approxKm(c.lat, c.lon, a.lat, a.lon);
  if (eAB > maxEdge || eBC > maxEdge || eCA > maxEdge) return false;
  const lo = Math.min(eAB, eBC, eCA);
  const hi = Math.max(eAB, eBC, eCA);
  if (lo < 1 || hi / lo > MAX_EDGE_RATIO) return false;
  // Reject near-collinear coastline strips (snake seeds).
  const s = 0.5 * (eAB + eBC + eCA);
  const area2 = s * (s - eAB) * (s - eBC) * (s - eCA);
  if (area2 <= 0) return false;
  const area = Math.sqrt(area2);
  // Minimum area ~ equilateral of side ~0.35*maxEdge
  const minArea = 0.05 * maxEdge * maxEdge;
  return area >= minArea;
}

/** Drop components that are long-and-thin (ribbon snakes). */
function pruneSnakeComponents(
  field: Uint8Array,
  width: number,
  height: number,
  minThicknessPx: number,
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
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (qh < qt) {
        const cx = qx[qh]!;
        const cy = qy[qh]!;
        qh += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const) {
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

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const box = bw * bh;
      const fill = cells.length / Math.max(1, box);
      const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      // Thin elongated snakes: low bbox fill + high aspect, or fails a thickness probe.
      const eroded = erodeMaskCells(field, cells, width, height, minThicknessPx);
      const snake =
        (aspect >= 3.2 && fill < 0.28) ||
        (aspect >= 2.4 && fill < 0.18) ||
        (cells.length > 80 && eroded < cells.length * 0.08);
      if (snake) {
        for (const i of cells) field[i] = 0;
      }
    }
  }
}

function erodeMaskCells(
  field: Uint8Array,
  cells: number[],
  width: number,
  height: number,
  radius: number,
): number {
  if (radius <= 0) return cells.length;
  const set = new Set(cells);
  let cur = set;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Set<number>();
    for (const i of cur) {
      const x = i % width;
      const y = (i / width) | 0;
      if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;
      if (
        cur.has(i - 1) &&
        cur.has(i + 1) &&
        cur.has(i - width) &&
        cur.has(i + width)
      ) {
        next.add(i);
      }
    }
    cur = next;
    if (!cur.size) return 0;
  }
  return cur.size;
}

/**
 * Nested rank field from compact Delaunay triangles only.
 * No ribbon chaining — that produced the long “snakes”.
 */
function buildMeshRankField(
  points: AutoRiskSamplePoint[],
  width: number,
  height: number,
  pick: (p: AutoRiskSamplePoint) => number,
): Uint8Array {
  const field = new Uint8Array(width * height);
  if (!points.length) return field;

  for (let rank = 1; rank <= AUTO_RISK_MAX_RANK; rank++) {
    const mesh: MeshPt[] = [];
    for (const p of points) {
      if (pick(p) < rank) continue;
      const { x, y } = latLonToPixel(p.lat, p.lon, width, height);
      mesh.push({ x, y, lat: p.lat, lon: p.lon });
    }
    if (mesh.length < 3) continue;

    const mask = new Uint8Array(width * height);
    const tris = delaunay(mesh);
    const maxEdge = MAX_EDGE_KM * (rank <= 2 ? 1.15 : rank <= 4 ? 1.0 : 0.9);

    for (const [ia, ib, ic] of tris) {
      const a = mesh[ia]!;
      const b = mesh[ib]!;
      const c = mesh[ic]!;
      if (!triangleOk(a, b, c, maxEdge)) continue;
      fillTriangle(mask, width, height, a.x, a.y, b.x, b.y, c.x, c.y);
    }

    // Knit joints, then open to kill thin corridor snakes.
    const closed = erode(
      dilate(mask, width, height, CLOSE_PX),
      width,
      height,
      Math.max(1, CLOSE_PX - 1),
    );
    const opened = dilate(
      erode(closed, width, height, OPEN_PX),
      width,
      height,
      OPEN_PX,
    );

    for (let i = 0; i < field.length; i++) {
      if (opened[i]) field[i] = rank;
    }
  }

  pruneSmallComponents(field, width, height, 90);
  pruneSnakeComponents(field, width, height, 2);
  return field;
}

function fieldToSoft(field: Uint8Array): Float32Array {
  const soft = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) soft[i] = field[i]!;
  return soft;
}

function quantizeFromSoft(soft: Float32Array, maxRank: number): Uint8Array {
  const field = new Uint8Array(soft.length);
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

  const rankWork = buildMeshRankField(
    points,
    work.width,
    work.height,
    (p) => p.rank,
  );
  const hatchWork = buildMeshRankField(
    points,
    work.width,
    work.height,
    (p) => p.hatch,
  );

  // Light soften only — heavy blur re-rounds polygons into circle-like blobs.
  const rankSoftWork = fieldToSoft(rankWork);
  const hatchSoftWork = fieldToSoft(hatchWork);
  blurFloat(rankSoftWork, work.width, work.height, 3);
  blurFloat(hatchSoftWork, work.width, work.height, 2);

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
  blurFloat(rankSoft, out.width, out.height, 1);
  blurFloat(hatchSoft, out.width, out.height, 1);

  const ranks = quantizeFromSoft(rankSoft, AUTO_RISK_MAX_RANK);
  pruneSmallComponents(ranks, out.width, out.height, 140);

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
