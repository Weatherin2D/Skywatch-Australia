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

/** Max triangle edge (km). Low ranks stretch farther so tropical floors merge. */
const MAX_EDGE_KM = 210;
/** Reject skinny triangles (longest/shortest edge). Stops coastline “snakes”. */
const MAX_EDGE_RATIO = 2.45;
/** Morphological close after fill — knits triangle joints / seals pinholes. */
const CLOSE_PX = 5;
/** Light opening — strips hairline snakes without punching interior holes. */
const OPEN_PX = 2;
/** Guaranteed width (px) of each outer band around the next-higher core. */
const NEST_GAP_PX = 5;
/** Drop sample sites with fewer than this many neighbours inside NEIGHBOR_KM. */
const MIN_SAMPLE_NEIGHBORS = 1;
const SAMPLE_NEIGHBOR_KM = 165;

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

/**
 * Drop lone elevated samples before meshing — a 1–2 site cluster can still
 * form a Delaunay triangle with far neighbours and paint a speck.
 */
function consolidateSamplePoints(
  points: AutoRiskSamplePoint[],
): AutoRiskSamplePoint[] {
  if (points.length < 3) return [];
  const elevated = points.filter((p) => p.rank > 0 || p.hatch > 0);
  if (elevated.length < 3) return [];

  return elevated
    .map((p) => {
      let neighbours = 0;
      for (const o of elevated) {
        if (o === p) continue;
        if (approxKm(p.lat, p.lon, o.lat, o.lon) <= SAMPLE_NEIGHBOR_KM) {
          neighbours += 1;
          if (neighbours >= MIN_SAMPLE_NEIGHBORS) break;
        }
      }
      if (neighbours >= MIN_SAMPLE_NEIGHBORS) return p;
      // Keep hatch-only hints only when a neighbour exists.
      if (p.hatch > 0 && neighbours >= 1) {
        return { ...p, rank: Math.min(p.rank, 3) };
      }
      return null;
    })
    .filter((p): p is AutoRiskSamplePoint => p != null);
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

/**
 * Fill enclosed zeros (donut holes). Exterior is whatever touches the border.
 */
function fillMaskHoles(
  mask: Uint8Array,
  width: number,
  height: number,
): void {
  const exterior = new Uint8Array(mask.length);
  const qx = new Int32Array(mask.length);
  const qy = new Int32Array(mask.length);
  let qh = 0;
  let qt = 0;

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (mask[i] || exterior[i]) return;
    exterior[i] = 1;
    qx[qt] = x;
    qy[qt] = y;
    qt += 1;
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (qh < qt) {
    const x = qx[qh]!;
    const y = qy[qh]!;
    qh += 1;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] && !exterior[i]) mask[i] = 1;
  }
}

/** Ensure field[i] >= R everywhere inside a solid ≥R region (no nested dips). */
function fillRankHoles(
  field: Uint8Array,
  width: number,
  height: number,
  rank: number,
): void {
  const mask = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) {
    if (field[i]! >= rank) mask[i] = 1;
  }
  fillMaskHoles(mask, width, height);
  for (let i = 0; i < field.length; i++) {
    if (mask[i] && field[i]! < rank) field[i] = rank;
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
      // Thickness-first: hairline corridors die under a light erode.
      // Avoid bbox-fill heuristics alone — nested rings look "hollow" too.
      const eroded = erodeMaskCells(field, cells, width, height, minThicknessPx);
      const snake =
        (cells.length > 40 && eroded === 0) ||
        (cells.length > 100 &&
          eroded < cells.length * 0.04 &&
          aspect >= 3.8 &&
          fill < 0.12);
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
  maxRank = AUTO_RISK_MAX_RANK,
): Uint8Array {
  const field = new Uint8Array(width * height);
  const consolidated = consolidateSamplePoints(points);
  if (!consolidated.length) return field;

  const bands: (Uint8Array | null)[] = Array.from(
    { length: maxRank + 1 },
    () => null,
  );

  for (let rank = 1; rank <= maxRank; rank++) {
    const mesh: MeshPt[] = [];
    for (const p of consolidated) {
      if (pick(p) < rank) continue;
      const { x, y } = latLonToPixel(p.lat, p.lon, width, height);
      mesh.push({ x, y, lat: p.lat, lon: p.lon });
    }
    if (mesh.length < 3) continue;

    const mask = new Uint8Array(width * height);
    const tris = delaunay(mesh);
    const maxEdge =
      MAX_EDGE_KM *
      (rank <= 2 ? 1.4 : rank <= 3 ? 1.2 : rank <= 4 ? 1.05 : 0.9);

    for (const [ia, ib, ic] of tris) {
      const a = mesh[ia]!;
      const b = mesh[ib]!;
      const c = mesh[ic]!;
      if (!triangleOk(a, b, c, maxEdge)) continue;
      fillTriangle(mask, width, height, a.x, a.y, b.x, b.y, c.x, c.y);
    }

    // Knit joints / seal pinholes, fill donuts, then light-open hairlines.
    fillMaskHoles(mask, width, height);
    const closed = erode(
      dilate(mask, width, height, CLOSE_PX),
      width,
      height,
      Math.max(1, CLOSE_PX - 1),
    );
    fillMaskHoles(closed, width, height);
    const opened = dilate(
      erode(closed, width, height, OPEN_PX),
      width,
      height,
      OPEN_PX,
    );
    fillMaskHoles(opened, width, height);
    bands[rank] = opened;
  }

  // Thicken existing outer bands around higher cores — but never invent a
  // lower-rank bullseye ring from a lone high-rank speck (outer must exist).
  for (let rank = maxRank - 1; rank >= 1; rank--) {
    const outer = bands[rank];
    const inner = bands[rank + 1];
    if (!inner || !outer) continue;
    fillMaskHoles(inner, width, height);
    const halo = dilate(inner, width, height, NEST_GAP_PX);
    for (let i = 0; i < outer.length; i++) {
      if (halo[i]) outer[i] = 1;
    }
    fillMaskHoles(outer, width, height);
  }

  // Paint low → high so cores sit inside padded envelopes.
  for (let rank = 1; rank <= maxRank; rank++) {
    const band = bands[rank];
    if (!band) continue;
    fillMaskHoles(band, width, height);
    for (let i = 0; i < field.length; i++) {
      if (band[i]) field[i] = rank;
    }
  }

  // Kill inverted dips: a higher band must stay solid (no lower-rank islands).
  for (let rank = maxRank; rank >= 1; rank--) {
    fillRankHoles(field, width, height, rank);
  }

  pruneSmallComponents(field, width, height, 280);
  // Drop disconnected islands of every rank (not only Severe+) — Pulse Low /
  // T-Storm floors were leaving salt-and-pepper triangles across the continent.
  pruneTinyIslands(field, width, height);
  pruneSnakeComponents(field, width, height, 3);
  // Re-seal any holes opened by pruning.
  for (let rank = AUTO_RISK_MAX_RANK; rank >= 1; rank--) {
    fillRankHoles(field, width, height, rank);
  }
  return field;
}

/**
 * Remove / demote small same-rank islands. Low ranks need a larger footprint
 * so tropical pulse floors don't paint a triangle speck at every town.
 */
function pruneTinyIslands(
  field: Uint8Array,
  width: number,
  height: number,
) {
  const seen = new Uint8Array(field.length);
  const qx = new Int32Array(field.length);
  const qy = new Int32Array(field.length);
  const area = width * height;

  const minCoreFor = (rank: number) => {
    if (rank <= 2) return Math.max(420, Math.round(area / 9_000));
    if (rank === 3) return Math.max(300, Math.round(area / 12_000));
    return Math.max(200, Math.round(area / 16_000));
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      const rank = field[start]!;
      if (rank < 1 || seen[start]) continue;
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
      if (cells.length >= minCoreFor(rank)) continue;
      // Demote to the highest strictly-lower neighbour, else clear.
      for (const i of cells) {
        const cx = i % width;
        const cy = (i / width) | 0;
        let demote = 0;
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
          [cx - 1, cy - 1],
          [cx + 1, cy - 1],
          [cx - 1, cy + 1],
          [cx + 1, cy + 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nr = field[ny * width + nx]!;
          if (nr > 0 && nr < rank && nr > demote) demote = nr;
        }
        field[i] = demote;
      }
    }
  }
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

export type RenderAutoRiskOptions = {
  maxRank?: number;
  colors?: Record<number, [number, number, number, number]>;
  /** When false, skip L1/L2 hatch overlays (chance products). */
  hatch?: boolean;
};

/**
 * Final rank/hatch fields after the same mesh → blur → prune path the PNG uses.
 * Legend "used" flags must come from this, not raw sample points — otherwise
 * tiny high-rank cores that get pruned still light up Severe+ in the key.
 */
export function buildRenderedRiskFields(
  points: AutoRiskSamplePoint[],
  options: RenderAutoRiskOptions = {},
): { ranks: Uint8Array; hatches: Uint8Array; width: number; height: number } {
  const maxRank = options.maxRank ?? AUTO_RISK_MAX_RANK;
  const drawHatch = options.hatch !== false;
  const work = sizeFor(WORK_WIDTH);
  const out = sizeFor(OUT_WIDTH);

  const rankWork = buildMeshRankField(
    points,
    work.width,
    work.height,
    (p) => p.rank,
    maxRank,
  );
  const hatchWork = drawHatch
    ? buildMeshRankField(
        points,
        work.width,
        work.height,
        (p) => p.hatch,
        2,
      )
    : new Uint8Array(work.width * work.height);

  const rankSoftWork = fieldToSoft(rankWork);
  const hatchSoftWork = fieldToSoft(hatchWork);
  // Slightly stronger work-space blur so denser sample meshes don't look speckled.
  blurFloat(rankSoftWork, work.width, work.height, 4);
  if (drawHatch) blurFloat(hatchSoftWork, work.width, work.height, 3);

  const rankSoft = upsampleBilinear(
    rankSoftWork,
    work.width,
    work.height,
    out.width,
    out.height,
  );
  const hatchSoft = drawHatch
    ? upsampleBilinear(
        hatchSoftWork,
        work.width,
        work.height,
        out.width,
        out.height,
      )
    : new Float32Array(out.width * out.height);
  blurFloat(rankSoft, out.width, out.height, 1);
  if (drawHatch) blurFloat(hatchSoft, out.width, out.height, 1);

  const ranks = quantizeFromSoft(rankSoft, maxRank);
  pruneSmallComponents(ranks, out.width, out.height, 140);
  for (let rank = maxRank; rank >= 1; rank--) {
    fillRankHoles(ranks, out.width, out.height, rank);
  }

  const hatches = new Uint8Array(hatchSoft.length);
  if (drawHatch) {
    for (let i = 0; i < hatchSoft.length; i++) {
      const v = hatchSoft[i]!;
      if (v < 0.55) hatches[i] = 0;
      else if (v < 1.45) hatches[i] = 1;
      else hatches[i] = 2;
    }
  }

  return { ranks, hatches, width: out.width, height: out.height };
}

/** Georeferenced PNG for Leaflet ImageOverlay. */
export function renderAutoRiskPng(
  points: AutoRiskSamplePoint[],
  options: RenderAutoRiskOptions = {},
): Buffer {
  const colors = options.colors ?? COLOR_BY_RANK;
  const drawHatch = options.hatch !== false;
  const { ranks, hatches, width, height } = buildRenderedRiskFields(
    points,
    options,
  );
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
    const [r, g, b, a] = colors[rank] ?? [120, 120, 120, 160];
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = a;
  }

  if (drawHatch) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!ranks[i]) continue;
        const h = hatches[i]!;
        if (h === 1 || h === 2) paintHatch(png, width, height, x, y, h);
      }
    }
  }

  paintRankOutlines(png, ranks, width, height, OUTLINE_PX);
  return PNG.sync.write(png);
}

/** Ranks/hatches present on raw sample sites (pre-raster prune). */
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

/**
 * Fast legend used-flags. Prefer consolidated neighbours so lone pinpricks
 * don't light Severe in the key, but never wipe an entire day's signal —
 * outlook status / map visibility use dayPoints, not this alone.
 */
export function summarizeUsedForLegend(
  points: AutoRiskSamplePoint[],
): { ranks: Set<number>; hatches: Set<AutoHatchId> } {
  if (!points.length) return { ranks: new Set(), hatches: new Set() };
  const kept = consolidateSamplePoints(points);
  // If consolidation removed everything, fall back to raw samples so the
  // catalog does not report a false "no risk" empty outlook.
  return summarizeUsed(kept.length ? kept : points);
}

/**
 * Sample the painted risk field at a lat/lon (same pipeline as the PNG).
 * Used by map-tap inspect so category matches what the user sees.
 */
export function samplePaintedRiskAt(
  points: AutoRiskSamplePoint[],
  lat: number,
  lon: number,
  options: RenderAutoRiskOptions = {},
): { rank: number; hatch: 0 | 1 | 2; inBounds: boolean } {
  if (
    lat < AU.minLat ||
    lat > AU.maxLat ||
    lon < AU.minLon ||
    lon > AU.maxLon
  ) {
    return { rank: 0, hatch: 0, inBounds: false };
  }
  if (!points.length) return { rank: 0, hatch: 0, inBounds: true };

  const { ranks, hatches, width, height } = buildRenderedRiskFields(
    points,
    options,
  );
  const { x, y } = latLonToPixel(lat, lon, width, height);
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const i = iy * width + ix;
  const rank = ranks[i] ?? 0;
  const hatchRaw = hatches[i] ?? 0;
  const hatch = (hatchRaw === 1 || hatchRaw === 2 ? hatchRaw : 0) as 0 | 1 | 2;
  return { rank, hatch, inBounds: true };
}
