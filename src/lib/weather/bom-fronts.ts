/**
 * Authoritative Australian fronts from BoM colour MSLP analysis (IDY00030).
 *
 * BoM does not publish front vectors. Meteorologists draw fronts on the
 * manual colour chart with a fixed palette:
 *   cold / trough / monsoon  rgb(0, 0, 255)
 *   warm                     rgb(255, 0, 0)
 *   occluded                 rgb(160, 32, 240)
 *   stationary               alternating red / blue segments
 *
 * We fetch the timestamped PNG, mask those colours, thin + trace polylines,
 * bridge fragments cut by isobars/labels, and georeference with the stretch
 * fit that locks the chart to GIBS AU bounds.
 */

import { PNG } from "pngjs";
import { GIBS_AU_BOUNDS, lonLatToWebMercator } from "@/lib/weather/maps";
import type { FrontKind, SynopticFeature } from "@/lib/weather/synoptic-contour";
import fit from "@/lib/weather/synoptic-fit.json";

const BOM_CHART_BASE = "https://www.bom.gov.au/fwo";
const BOM_PRODUCT = "IDY00030";
const USER_AGENT = "SkyWatchAustralia/1.0";

/** Palette targets (exact BoM legend colours). */
const COLD_RGB: [number, number, number] = [0, 0, 255];
const WARM_RGB: [number, number, number] = [255, 0, 0];
const OCCLUDED_RGB: [number, number, number] = [160, 32, 240];
/** Occasional chart magenta used for some occluded / complex fronts. */
const OCCLUDED_ALT: [number, number, number] = [230, 50, 230];

const COLOR_TOL = 42;
const MIN_COMPONENT_PIXELS = 14;
const BRIDGE_GAP = 10;
const BRIDGE_GAP_ALIGNED = 28;
const BRIDGE_MAX_ANGLE = 42;
const CHAIN_MAX_LEN = 95;
const CHAIN_GAP = 14;
const MIN_PATH_PX = 18;
const MIN_COLD_PX = 70;
const MIN_GEO_DEG = 1.0;

type Pixel = [number, number];

type PixelFront = {
  kind: FrontKind;
  points: Pixel[];
  pixelLength: number;
};

type CacheEntry = {
  fetchedAt: number;
  features: SynopticFeature[];
  stamp: string;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 25 * 60 * 1000;

export const BOM_FRONTS_ATTRIBUTION =
  "Fronts · BoM IDY00030 colour MSLP analysis";

function near(
  c: [number, number, number],
  t: [number, number, number],
  tol = COLOR_TOL,
): boolean {
  return (
    Math.abs(c[0] - t[0]) <= tol &&
    Math.abs(c[1] - t[1]) <= tol &&
    Math.abs(c[2] - t[2]) <= tol
  );
}

function webMercatorToLonLat(x: number, y: number): [number, number] {
  const lon = (x / 20037508.34) * 180;
  let lat = (y / 20037508.34) * 180;
  lat =
    (180 / Math.PI) *
    (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lon, lat];
}

/** Chart pixel → WGS84 using stretch-v13 into the GIBS AU mercator plane. */
export function chartPxToLonLat(cx: number, cy: number): [number, number] {
  const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
  const [minX, minY] = lonLatToWebMercator(west, south);
  const [maxX, maxY] = lonLatToWebMercator(east, north);
  const ox = fit.scX * (cx - fit.chartCx) + fit.tx;
  const oy = fit.scY * (cy - fit.chartCy) + fit.ty;
  const mx = minX + (ox / fit.outW) * (maxX - minX);
  const my = maxY - (oy / fit.outH) * (maxY - minY);
  return webMercatorToLonLat(mx, my);
}

function pathPixelLength(pts: Pixel[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

function smoothLine(coords: Pixel[], passes = 2): Pixel[] {
  let pts = coords;
  for (let p = 0; p < passes; p++) {
    if (pts.length < 3) break;
    const next: Pixel[] = [pts[0]!];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const c = pts[i + 1]!;
      next.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

function chaikin(pts: Pixel[], iters = 1): Pixel[] {
  let cur = pts;
  for (let n = 0; n < iters; n++) {
    if (cur.length < 2) break;
    const out: Pixel[] = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!;
      const b = cur[i + 1]!;
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(cur[cur.length - 1]!);
    cur = out;
  }
  return cur;
}

type Component = {
  pixels: Pixel[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function connectedComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  usableH: number,
): Component[] {
  const seen = new Uint8Array(w * h);
  const comps: Component[] = [];
  for (let y = 0; y < usableH; y++) {
    for (let x = 0; x < w; x++) {
      const i0 = y * w + x;
      if (!mask[i0] || seen[i0]) continue;
      const q: Pixel[] = [[x, y]];
      seen[i0] = 1;
      const pixels: Pixel[] = [];
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y;
      while (q.length) {
        const [cx, cy] = q.pop()!;
        pixels.push([cx, cy]);
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= usableH) continue;
            const ni = ny * w + nx;
            if (seen[ni] || !mask[ni]) continue;
            seen[ni] = 1;
            q.push([nx, ny]);
          }
        }
      }
      comps.push({ pixels, minX, maxX, minY, maxY });
    }
  }
  return comps;
}

/** Zhang–Suen thinning on one component → skeleton pixels in chart space. */
function thinComponent(comp: Component): Pixel[] {
  const pad = 2;
  const bw = comp.maxX - comp.minX + 1 + pad * 2;
  const bh = comp.maxY - comp.minY + 1 + pad * 2;
  let grid = new Uint8Array(bw * bh);
  for (const [x, y] of comp.pixels) {
    grid[(y - comp.minY + pad) * bw + (x - comp.minX + pad)] = 1;
  }

  const neighbors = (i: number) => {
    const x = i % bw;
    const y = (i / bw) | 0;
    return [
      grid[(y - 1) * bw + x] || 0,
      grid[(y - 1) * bw + (x + 1)] || 0,
      grid[y * bw + (x + 1)] || 0,
      grid[(y + 1) * bw + (x + 1)] || 0,
      grid[(y + 1) * bw + x] || 0,
      grid[(y + 1) * bw + (x - 1)] || 0,
      grid[y * bw + (x - 1)] || 0,
      grid[(y - 1) * bw + (x - 1)] || 0,
    ] as const;
  };

  const iter = (step: 0 | 1) => {
    const del: number[] = [];
    for (let y = 1; y < bh - 1; y++) {
      for (let x = 1; x < bw - 1; x++) {
        const i = y * bw + x;
        if (!grid[i]) continue;
        const [p2, p3, p4, p5, p6, p7, p8, p9] = neighbors(i);
        const bp = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (bp < 2 || bp > 6) continue;
        const a =
          Number(p2 === 0 && p3 === 1) +
          Number(p3 === 0 && p4 === 1) +
          Number(p4 === 0 && p5 === 1) +
          Number(p5 === 0 && p6 === 1) +
          Number(p6 === 0 && p7 === 1) +
          Number(p7 === 0 && p8 === 1) +
          Number(p8 === 0 && p9 === 1) +
          Number(p9 === 0 && p2 === 1);
        if (a !== 1) continue;
        if (step === 0) {
          if (p2 * p4 * p6 !== 0) continue;
          if (p4 * p6 * p8 !== 0) continue;
        } else {
          if (p2 * p4 * p8 !== 0) continue;
          if (p2 * p6 * p8 !== 0) continue;
        }
        del.push(i);
      }
    }
    for (const i of del) grid[i] = 0;
    return del.length;
  };

  for (let k = 0; k < 48; k++) {
    if (iter(0) + iter(1) === 0) break;
  }

  const skel: Pixel[] = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (grid[y * bw + x]) {
        skel.push([x - pad + comp.minX, y - pad + comp.minY]);
      }
    }
  }
  return skel;
}

function traceSkeleton(skel: Pixel[]): Pixel[][] {
  if (skel.length < 2) return [];
  const key = (x: number, y: number) => `${x},${y}`;
  const set = new Set(skel.map(([x, y]) => key(x, y)));
  const adj = new Map<string, Pixel[]>();
  for (const [x, y] of skel) {
    const ns: Pixel[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const k = key(x + dx, y + dy);
        if (set.has(k)) ns.push([x + dx, y + dy]);
      }
    }
    adj.set(key(x, y), ns);
  }

  const used = new Set<string>();
  const lines: Pixel[][] = [];
  const starts = [...adj.entries()].sort((a, b) => a[1].length - b[1].length);

  for (const [k0] of starts) {
    if (used.has(k0)) continue;
    let [x, y] = k0.split(",").map(Number) as Pixel;
    const line: Pixel[] = [[x, y]];
    used.add(k0);
    let guard = 0;
    while (guard++ < 20000) {
      const nbs = adj.get(key(x, y)) || [];
      let next: Pixel | null = null;
      for (const [nx, ny] of nbs) {
        const nk = key(nx, ny);
        if (used.has(nk)) continue;
        next = [nx, ny];
        break;
      }
      if (!next) break;
      x = next[0];
      y = next[1];
      line.push([x, y]);
      used.add(key(x, y));
    }
    if (line.length >= 3) lines.push(line);
  }
  return lines;
}

function endTangent(pts: Pixel[]): [number, number] {
  const last = pts[pts.length - 1]!;
  let ref = pts[pts.length - 2] ?? last;
  for (let i = pts.length - 2; i >= 0; i--) {
    ref = pts[i]!;
    if (Math.hypot(last[0] - ref[0], last[1] - ref[1]) >= 6) break;
  }
  const len = Math.hypot(last[0] - ref[0], last[1] - ref[1]) || 1;
  return [(last[0] - ref[0]) / len, (last[1] - ref[1]) / len];
}

type Join = {
  gap: number;
  outA: [number, number];
  inB: [number, number];
  bridge: [number, number] | null;
  merge: () => Pixel[];
};

function bestJoin(a: Pixel[], b: Pixel[]): Join {
  const d = (p: Pixel, q: Pixel) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const options = [
    { gap: d(a[a.length - 1]!, b[0]!), a2: a, b2: b },
    { gap: d(a[a.length - 1]!, b[b.length - 1]!), a2: a, b2: [...b].reverse() },
    { gap: d(a[0]!, b[0]!), a2: [...a].reverse(), b2: b },
    { gap: d(a[0]!, b[b.length - 1]!), a2: b, b2: a },
  ].sort((x, y) => x.gap - y.gap);
  const { gap, a2, b2 } = options[0]!;
  const endA = a2[a2.length - 1]!;
  const startB = b2[0]!;
  const bridge: [number, number] | null =
    gap > 0.5
      ? [(startB[0] - endA[0]) / gap, (startB[1] - endA[1]) / gap]
      : null;
  return {
    gap,
    outA: endTangent(a2),
    inB: endTangent([...b2].reverse()).map((v) => -v) as [number, number],
    bridge,
    merge: () => [...a2, ...b2],
  };
}

function directionsAlign(join: Join): boolean {
  const cosMin = Math.cos((BRIDGE_MAX_ANGLE * Math.PI) / 180);
  const dot = (u: [number, number], v: [number, number]) =>
    u[0] * v[0] + u[1] * v[1];
  if (!join.bridge) return true;
  return (
    dot(join.outA, join.bridge) >= cosMin &&
    dot(join.bridge, join.inB) >= cosMin &&
    dot(join.outA, join.inB) >= cosMin
  );
}

function mergeFragments(paths: PixelFront[]): PixelFront[] {
  const list = paths.slice();
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = false;
    let best: { i: number; j: number; join: Join; gap: number } | null = null;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i]!.kind !== list[j]!.kind) continue;
        // Troughs stay dashed — only bridge tiny gaps
        const maxGap =
          list[i]!.kind === "trough" ? BRIDGE_GAP : BRIDGE_GAP_ALIGNED;
        const join = bestJoin(list[i]!.points, list[j]!.points);
        if (join.gap > maxGap) continue;
        if (
          list[i]!.kind !== "trough" &&
          join.gap > BRIDGE_GAP &&
          !directionsAlign(join)
        ) {
          continue;
        }
        if (!best || join.gap < best.gap) best = { i, j, join, gap: join.gap };
      }
    }
    if (best) {
      const a = list[best.i]!;
      const points = best.join.merge();
      list[best.i] = {
        kind: a.kind,
        points,
        pixelLength: pathPixelLength(points),
      };
      list.splice(best.j, 1);
      mergedSomething = true;
    }
  }
  return list;
}

/** Merge short alternating cold/warm segments into stationary fronts. */
function mergeStationaryChains(paths: PixelFront[]): {
  merged: Pixel[][];
  consumed: Set<PixelFront>;
} {
  const shorts = paths.filter(
    (p) =>
      (p.kind === "cold_front" || p.kind === "warm_front") &&
      p.pixelLength <= CHAIN_MAX_LEN,
  );
  const consumed = new Set<PixelFront>();
  const merged: Pixel[][] = [];

  const endpoint = (p: PixelFront, end: "start" | "end") =>
    end === "start" ? p.points[0]! : p.points[p.points.length - 1]!;

  for (const seed of shorts) {
    if (consumed.has(seed)) continue;
    const chain: PixelFront[] = [seed];
    consumed.add(seed);
    let grew = true;
    while (grew) {
      grew = false;
      const head = chain[0]!;
      const tail = chain[chain.length - 1]!;
      for (const cand of shorts) {
        if (consumed.has(cand)) continue;
        const needWarm = tail.kind === "cold_front";
        if (needWarm && cand.kind !== "warm_front") continue;
        if (!needWarm && cand.kind !== "cold_front") continue;
        const ends: Array<["start" | "end", "start" | "end"]> = [
          ["end", "start"],
          ["end", "end"],
          ["start", "start"],
          ["start", "end"],
        ];
        for (const [te, ce] of ends) {
          const a = endpoint(te === "end" ? tail : head, te);
          const b = endpoint(cand, ce);
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) > CHAIN_GAP) continue;
          if (te === "end") {
            const pts =
              ce === "start" ? cand.points : [...cand.points].reverse();
            chain.push({ ...cand, points: pts });
          } else {
            const pts =
              ce === "end" ? cand.points : [...cand.points].reverse();
            chain.unshift({ ...cand, points: pts });
          }
          consumed.add(cand);
          grew = true;
          break;
        }
        if (grew) break;
      }
    }
    if (chain.length >= 3) {
      const pts: Pixel[] = [];
      for (const c of chain) pts.push(...c.points);
      merged.push(pts);
    } else {
      for (const c of chain) consumed.delete(c);
    }
  }
  return { merged, consumed };
}

function downsample(pts: Pixel[], maxPts = 48): Pixel[] {
  if (pts.length <= maxPts) return pts;
  const step = Math.max(1, Math.floor(pts.length / maxPts));
  const out: Pixel[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]!);
  const last = pts[pts.length - 1]!;
  const prev = out[out.length - 1]!;
  if (prev[0] !== last[0] || prev[1] !== last[1]) out.push(last);
  return out;
}

function geoLengthDeg(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon0, lat0] = coords[i - 1]!;
    const [lon1, lat1] = coords[i]!;
    const dx = (lon1 - lon0) * Math.cos(((lat0 + lat1) / 2) * (Math.PI / 180));
    const dy = lat1 - lat0;
    len += Math.hypot(dx, dy);
  }
  return len;
}

function toFeature(kind: FrontKind, points: Pixel[]): SynopticFeature | null {
  const sampled = downsample(chaikin(smoothLine(points, 1), 1), 56);
  const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
  const coords: [number, number][] = [];
  for (const [x, y] of sampled) {
    const [lon, lat] = chartPxToLonLat(x, y);
    if (lon < west - 3 || lon > east + 3 || lat < south - 3 || lat > north + 3) {
      continue;
    }
    coords.push([lon, lat]);
  }
  if (coords.length < 3) return null;
  if (geoLengthDeg(coords) < MIN_GEO_DEG) return null;
  return {
    type: "Feature",
    properties: { kind },
    geometry: { type: "LineString", coordinates: coords },
  };
}

function classifyBluePath(pixelLength: number): FrontKind {
  // After fragment merge: long continuous blue = cold front (barbs are
  // cosmetic on the chart). Short leftover dashes = pressure trough.
  if (pixelLength >= MIN_COLD_PX) return "cold_front";
  if (pixelLength >= MIN_PATH_PX) return "trough";
  return "trough";
}

function extractFromPng(buffer: Buffer): SynopticFeature[] {
  const png = PNG.sync.read(buffer);
  const { width: w, height: h, data } = png;
  const legendH = fit.legendH ?? 70;
  const usableH = Math.max(1, h - legendH);

  const coldMask = new Uint8Array(w * h);
  const warmMask = new Uint8Array(w * h);
  const occMask = new Uint8Array(w * h);

  for (let y = 0; y < usableH; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c: [number, number, number] = [data[i]!, data[i + 1]!, data[i + 2]!];
      const mi = y * w + x;
      if (near(c, COLD_RGB) && c[2]! >= 170) coldMask[mi] = 1;
      else if (near(c, WARM_RGB) && c[0]! >= 170) warmMask[mi] = 1;
      else if (near(c, OCCLUDED_RGB, 55) || near(c, OCCLUDED_ALT, 50))
        occMask[mi] = 1;
    }
  }

  const traced: PixelFront[] = [];

  const ingest = (
    mask: Uint8Array,
    kind: FrontKind,
  ) => {
    const comps = connectedComponents(mask, w, h, usableH).filter(
      (c) => c.pixels.length >= MIN_COMPONENT_PIXELS,
    );
    for (const comp of comps) {
      const boxW = comp.maxX - comp.minX + 1;
      const boxH = comp.maxY - comp.minY + 1;
      // Drop tiny letter / barb-only blobs
      if (boxW <= 14 && boxH <= 18 && comp.pixels.length < 70) continue;
      const skel = thinComponent(comp);
      const lines = traceSkeleton(skel);
      for (const line of lines) {
        if (line.length < 3) continue;
        const len = pathPixelLength(line);
        if (len < MIN_PATH_PX) continue;
        traced.push({ kind, points: line, pixelLength: len });
      }
    }
  };

  // Treat all blue as cold first so fragments re-join across isobar gaps;
  // reclassify short leftovers as troughs after merge.
  ingest(coldMask, "cold_front");
  ingest(warmMask, "warm_front");
  ingest(occMask, "occluded_front");

  let paths = mergeFragments(traced);
  paths = paths.map((p) => {
    if (p.kind !== "cold_front") return p;
    return {
      ...p,
      kind: classifyBluePath(p.pixelLength),
    };
  });
  // Second merge pass so trough dashes can join each other
  paths = mergeFragments(paths);

  const { merged: stationary, consumed } = mergeStationaryChains(paths);
  const features: SynopticFeature[] = [];

  for (const pts of stationary) {
    const f = toFeature("stationary_front", pts);
    if (f) features.push(f);
  }
  for (const p of paths) {
    if (consumed.has(p)) continue;
    if (
      (p.kind === "cold_front" || p.kind === "warm_front") &&
      p.pixelLength < MIN_COLD_PX * 0.45
    ) {
      continue;
    }
    const f = toFeature(p.kind, p.points);
    if (f) features.push(f);
  }

  // Prefer fewer, longer fronts — drop near-duplicates
  features.sort((a, b) => {
    const la = geoLengthDeg(a.geometry.coordinates as [number, number][]);
    const lb = geoLengthDeg(b.geometry.coordinates as [number, number][]);
    return lb - la;
  });

  const kept: SynopticFeature[] = [];
  for (const f of features) {
    const coords = f.geometry.coordinates as [number, number][];
    const mid = coords[(coords.length / 2) | 0]!;
    const dup = kept.some((k) => {
      if (k.properties.kind !== f.properties.kind) return false;
      const kc = k.geometry.coordinates as [number, number][];
      const km = kc[(kc.length / 2) | 0]!;
      return Math.hypot(mid[0] - km[0], mid[1] - km[1]) < 2.5;
    });
    if (!dup) kept.push(f);
  }
  return kept;
}

function stampCandidates(stamp: string): string[] {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return [stamp];
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  // BoM IDY00030 is issued at 00/06/12/18 UTC only — snap down to that cadence.
  const synHour = Math.floor(hour / 6) * 6;
  const base = Date.UTC(y, mo, day, synHour, 0);
  const out: string[] = [];
  for (const hours of [0, -6, 6, -12, 12, -18, 18, -24]) {
    const d = new Date(base + hours * 3600 * 1000);
    const s =
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
      `${String(d.getUTCDate()).padStart(2, "0")}` +
      `${String(d.getUTCHours()).padStart(2, "0")}00`;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

async function fetchChartPng(stamp: string): Promise<{ stamp: string; buf: Buffer } | null> {
  for (const s of stampCandidates(stamp)) {
    const url = `${BOM_CHART_BASE}/${BOM_PRODUCT}.${s}.png`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "image/png,*/*" },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("png") && !ct.includes("octet-stream")) continue;
      const ab = await res.arrayBuffer();
      if (ab.byteLength < 8_000) continue;
      const buf = Buffer.from(ab);
      // PNG magic
      if (buf[0] !== 0x89 || buf[1] !== 0x50) continue;
      return { stamp: s, buf };
    } catch {
      // try next stamp
    }
  }
  return null;
}

/**
 * Front features for a synoptic valid-time stamp (YYYYMMDDHHMM UTC).
 * Returns [] when the BoM chart is unavailable.
 */
export async function getBomFrontFeatures(
  stamp: string,
): Promise<SynopticFeature[]> {
  const cached = cache.get(stamp);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.features;
  }

  const fetched = await fetchChartPng(stamp);
  if (!fetched) {
    cache.set(stamp, { fetchedAt: Date.now(), features: [], stamp });
    return [];
  }

  try {
    const features = extractFromPng(fetched.buf);
    cache.set(stamp, {
      fetchedAt: Date.now(),
      features,
      stamp: fetched.stamp,
    });
    // Also cache under the chart's actual stamp
    if (fetched.stamp !== stamp) {
      cache.set(fetched.stamp, {
        fetchedAt: Date.now(),
        features,
        stamp: fetched.stamp,
      });
    }
    return features;
  } catch (err) {
    console.error("BoM front extraction failed", err);
    return [];
  }
}

/** Test helper: extract fronts from an already-downloaded PNG buffer. */
export function extractBomFrontsFromPng(buffer: Buffer): SynopticFeature[] {
  return extractFromPng(buffer);
}
