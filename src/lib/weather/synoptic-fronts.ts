/**
 * Derive a small set of meteorologically plausible fronts / troughs.
 *
 * Strategy:
 * 1. Strong |∇T| ridges followed along the front (⊥ to ∇T) — not noisy grid walks
 * 2. Require a clear cross-front temperature jump
 * 3. Prefer fronts near pressure packing / troughs
 * 4. Keep only the longest / strongest candidates
 */

import type { SynopticField } from "@/lib/weather/synoptic-grid";

export type FrontFeature = {
  type: "Feature";
  properties: {
    kind: "cold_front" | "warm_front" | "stationary_front" | "trough";
    warmSide?: [number, number];
  };
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
};

function at(arr: Float64Array, cols: number, row: number, col: number): number {
  if (row < 0 || col < 0 || row >= arr.length / cols || col >= cols) {
    return Number.NaN;
  }
  return arr[row * cols + col]!;
}

function lonAt(field: SynopticField, col: number): number {
  return field.west + col * field.step;
}

function latAt(field: SynopticField, row: number): number {
  return field.south + (field.rows - 1 - row) * field.step;
}

function windUV(speed: number, fromDeg: number): [number, number] {
  const rad = (fromDeg * Math.PI) / 180;
  return [-Math.sin(rad) * speed, -Math.cos(rad) * speed];
}

function lineLengthKm(coords: [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon0, lat0] = coords[i - 1]!;
    const [lon1, lat1] = coords[i]!;
    const midLat = ((lat0 + lat1) / 2) * (Math.PI / 180);
    const dx = (lon1 - lon0) * Math.cos(midLat) * 111.32;
    const dy = (lat1 - lat0) * 111.32;
    sum += Math.hypot(dx, dy);
  }
  return sum;
}

/** Chaikin-ish / moving-average smooth in lon/lat. */
function smoothLine(
  coords: [number, number][],
  passes = 2,
): [number, number][] {
  let pts = coords;
  for (let p = 0; p < passes; p++) {
    if (pts.length < 3) break;
    const next: [number, number][] = [pts[0]!];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const c = pts[i + 1]!;
      next.push([
        (a[0] + 2 * b[0] + c[0]) / 4,
        (a[1] + 2 * b[1] + c[1]) / 4,
      ]);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(sorted.length * p)),
  );
  return sorted[i]!;
}

type GradFields = {
  dTdx: Float64Array;
  dTdy: Float64Array;
  magT: Float64Array;
  dPdx: Float64Array;
  dPdy: Float64Array;
  magP: Float64Array;
};

function computeGradients(field: SynopticField): GradFields {
  const { rows, cols, step } = field;
  const n = rows * cols;
  const dTdx = new Float64Array(n);
  const dTdy = new Float64Array(n);
  const magT = new Float64Array(n);
  const dPdx = new Float64Array(n);
  const dPdy = new Float64Array(n);
  const magP = new Float64Array(n);

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const lat = latAt(field, r) * (Math.PI / 180);
      const cos = Math.max(0.25, Math.cos(lat));
      const dxKm = step * 111.32 * cos;
      const dyKm = step * 111.32;
      const i = r * cols + c;

      const tE = at(field.temperatureC, cols, r, c + 1);
      const tW = at(field.temperatureC, cols, r, c - 1);
      const tN = at(field.temperatureC, cols, r - 1, c);
      const tS = at(field.temperatureC, cols, r + 1, c);
      if ([tE, tW, tN, tS].every(Number.isFinite)) {
        const gx = (tE - tW) / (2 * dxKm);
        const gy = (tN - tS) / (2 * dyKm);
        dTdx[i] = gx;
        dTdy[i] = gy;
        magT[i] = Math.hypot(gx, gy);
      }

      const pE = at(field.values, cols, r, c + 1);
      const pW = at(field.values, cols, r, c - 1);
      const pN = at(field.values, cols, r - 1, c);
      const pS = at(field.values, cols, r + 1, c);
      if ([pE, pW, pN, pS].every(Number.isFinite)) {
        const gx = (pE - pW) / (2 * dxKm);
        const gy = (pN - pS) / (2 * dyKm);
        dPdx[i] = gx;
        dPdy[i] = gy;
        magP[i] = Math.hypot(gx, gy);
      }
    }
  }
  return { dTdx, dTdy, magT, dPdx, dPdy, magP };
}

/**
 * Cross-front ΔT (°C) sampled ±1.2 grid steps along ∇T.
 */
function crossFrontDeltaT(
  field: SynopticField,
  r: number,
  c: number,
  dTdx: Float64Array,
  dTdy: Float64Array,
): number {
  const i = r * field.cols + c;
  const gx = dTdx[i]!;
  const gy = dTdy[i]!;
  const len = Math.hypot(gx, gy);
  if (len < 1e-9) return 0;
  const lat = latAt(field, r) * (Math.PI / 180);
  const cos = Math.max(0.25, Math.cos(lat));
  const step = 1.25;
  const dc = (gx / len) * step;
  const dr = (-gy / len) * step; // row +south
  // Convert km-normalized direction approx into grid steps already via step
  // Use physical: 1 grid ~ step degrees
  const dcG = (gx / len) * (step / (field.step * cos)) * field.step * cos;
  // Simpler index offset:
  const dcI = Math.round((gx / len) * 1.4);
  const drI = Math.round((-gy / len) * 1.4);
  const tWarm = at(field.temperatureC, field.cols, r + drI, c + dcI);
  const tCold = at(field.temperatureC, field.cols, r - drI, c - dcI);
  void dc;
  void dr;
  void dcG;
  if (!Number.isFinite(tWarm) || !Number.isFinite(tCold)) return 0;
  return Math.abs(tWarm - tCold);
}

function followRidge(
  field: SynopticField,
  startR: number,
  startC: number,
  ridge: Uint8Array,
  magT: Float64Array,
  dTdx: Float64Array,
  dTdy: Float64Array,
  used: Uint8Array,
): [number, number][] {
  const { rows, cols } = field;

  const walkDir = (
    r0: number,
    c0: number,
    sign: 1 | -1,
  ): [number, number][] => {
    const out: [number, number][] = [];
    let r = r0;
    let c = c0;
    let prevDr = 0;
    let prevDc = 0;
    for (let step = 0; step < 80; step++) {
      if (r < 2 || c < 2 || r >= rows - 2 || c >= cols - 2) break;
      const i = r * cols + c;
      if (!ridge[i]) break;
      if (step > 0 && used[i]) break;
      used[i] = 1;
      out.push([lonAt(field, c), latAt(field, r)]);

      const gx = dTdx[i]!;
      const gy = dTdy[i]!;
      const glen = Math.hypot(gx, gy) || 1;
      let dcPref = (-gy / glen) * sign;
      let drPref = (-(gx / glen)) * sign; // north component → -row
      // gy is northward temp gradient; along-front E = -gy, N = gx
      dcPref = (-gy / glen) * sign;
      drPref = -(gx / glen) * sign;

      if (step > 0 && prevDr * drPref + prevDc * dcPref < 0) {
        dcPref = -dcPref;
        drPref = -drPref;
      }

      let best: { r: number; c: number; score: number } | null = null;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          const nc = c + dc;
          const ni = nr * cols + nc;
          if (!ridge[ni] || (used[ni] && !(nr === r0 && nc === c0))) continue;
          if (used[ni]) continue;
          const align = (dc * dcPref + dr * drPref) / Math.hypot(dc, dr);
          if (align < 0.2) continue;
          const score = magT[ni]! * (0.5 + 0.5 * align);
          if (!best || score > best.score) best = { r: nr, c: nc, score };
        }
      }
      if (!best) break;
      prevDr = best.r - r;
      prevDc = best.c - c;
      r = best.r;
      c = best.c;
    }
    return out;
  };

  const forward = walkDir(startR, startC, 1);
  // Allow reverse walk from seed again
  used[startR * cols + startC] = 0;
  const backward = walkDir(startR, startC, -1);
  used[startR * cols + startC] = 1;

  // backward is seed→… ; reverse it and drop duplicate seed
  const left = backward.slice(1).reverse();
  return [...left, ...forward];
}

function detectThermalFronts(field: SynopticField): FrontFeature[] {
  const { rows, cols } = field;
  const grads = computeGradients(field);
  const { dTdx, dTdy, magT, magP } = grads;

  const magList: number[] = [];
  const pList: number[] = [];
  for (let i = 0; i < magT.length; i++) {
    if (magT[i]! > 0) magList.push(magT[i]!);
    if (magP[i]! > 0) pList.push(magP[i]!);
  }
  if (magList.length < 30) return [];
  magList.sort((a, b) => a - b);
  pList.sort((a, b) => a - b);

  // Only the sharpest thermal gradients (top ~8%)
  const tThresh = Math.max(percentile(magList, 0.92), 0.012);
  const pThresh = percentile(pList, 0.55);

  const ridge = new Uint8Array(rows * cols);
  const seeds: Array<{ r: number; c: number; score: number }> = [];

  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      const i = r * cols + c;
      const m = magT[i]!;
      if (m < tThresh) continue;

      // Non-max suppression along ∇T
      const gx = dTdx[i]!;
      const gy = dTdy[i]!;
      const len = Math.hypot(gx, gy) || 1;
      const dcI = Math.round(gx / len);
      const drI = Math.round(-gy / len);
      const m1 = magT[(r + drI) * cols + (c + dcI)] ?? 0;
      const m2 = magT[(r - drI) * cols + (c - dcI)] ?? 0;
      if (m < m1 || m < m2) continue;

      const dT = crossFrontDeltaT(field, r, c, dTdx, dTdy);
      // Need a real air-mass contrast (~≥3.5°C across the front at this scale)
      if (dT < 3.5) continue;

      // Prefer fronts also sitting in pressure packing (trough / gradient zone)
      const pBoost = magP[i]! >= pThresh ? 1.35 : 0.75;
      if (magP[i]! < pThresh * 0.45) continue;

      ridge[i] = 1;
      seeds.push({ r, c, score: m * dT * pBoost });
    }
  }

  seeds.sort((a, b) => b.score - a.score);
  const used = new Uint8Array(rows * cols);
  type Cand = {
    coords: [number, number][];
    score: number;
    kind: FrontFeature["properties"]["kind"];
    warmSide: [number, number];
  };
  const cands: Cand[] = [];

  for (const seed of seeds.slice(0, 40)) {
    if (used[seed.r * cols + seed.c]) continue;
    const raw = followRidge(
      field,
      seed.r,
      seed.c,
      ridge,
      magT,
      dTdx,
      dTdy,
      used,
    );
    if (raw.length < 4) continue;
    const coords = smoothLine(raw, 2);
    const lenKm = lineLengthKm(coords);
    // Synoptic-scale only
    if (lenKm < 700) continue;

    let advSum = 0;
    let advN = 0;
    let warmX = 0;
    let warmY = 0;
    let strength = 0;
    for (
      let i = 0;
      i < coords.length;
      i += Math.max(1, Math.floor(coords.length / 10))
    ) {
      const [lon, lat] = coords[i]!;
      const c = Math.round((lon - field.west) / field.step);
      const r = Math.round(
        (field.south + (field.rows - 1) * field.step - lat) / field.step,
      );
      if (r < 1 || c < 1 || r >= rows - 1 || c >= cols - 1) continue;
      const idx = r * cols + c;
      const spd = at(field.windSpeed, cols, r, c);
      const from = at(field.windFromDeg, cols, r, c);
      if (!Number.isFinite(spd) || !Number.isFinite(from)) continue;
      const [u, v] = windUV(spd, from);
      advSum += -(u * dTdx[idx]! + v * dTdy[idx]!);
      advN++;
      warmX += dTdx[idx]!;
      warmY += dTdy[idx]!;
      strength += magT[idx]! * (1 + magP[idx]!);
    }
    if (advN < 3) continue;
    const meanAdv = advSum / advN;
    const wLen = Math.hypot(warmX, warmY) || 1;

    let kind: Cand["kind"];
    if (meanAdv < -0.02) kind = "cold_front";
    else if (meanAdv > 0.02) kind = "warm_front";
    else kind = "stationary_front";

    cands.push({
      coords,
      score: strength * Math.sqrt(lenKm),
      kind,
      warmSide: [warmX / wLen, warmY / wLen],
    });
  }

  cands.sort((a, b) => b.score - a.score);

  // Keep a handful of primary fronts; suppress near-duplicates
  const kept: Cand[] = [];
  const mid = (coords: [number, number][]) =>
    coords[Math.floor(coords.length / 2)]!;

  for (const cand of cands) {
    if (kept.length >= 5) break;
    const m = mid(cand.coords);
    const tooClose = kept.some((k) => {
      const km = mid(k.coords);
      const dlat = (m[1] - km[1]) * 111;
      const dlon =
        (m[0] - km[0]) * 111 * Math.cos(((m[1] + km[1]) / 2) * (Math.PI / 180));
      return Math.hypot(dlat, dlon) < 550 && k.kind === cand.kind;
    });
    if (tooClose) continue;
    kept.push(cand);
  }

  return kept.map((k) => ({
    type: "Feature" as const,
    properties: {
      kind: k.kind,
      warmSide: k.warmSide,
    },
    geometry: { type: "LineString" as const, coordinates: k.coords },
  }));
}

function detectTroughs(field: SynopticField): FrontFeature[] {
  const { rows, cols, values, step } = field;
  const mask = new Uint8Array(rows * cols);
  const depth = new Float64Array(rows * cols);

  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      const v = at(values, cols, r, c);
      if (!Number.isFinite(v)) continue;
      const w = at(values, cols, r, c - 1);
      const e = at(values, cols, r, c + 1);
      const n = at(values, cols, r - 1, c);
      const s = at(values, cols, r + 1, c);
      if (![w, e, n, s].every(Number.isFinite)) continue;
      const ewMin = v + 0.15 < w && v + 0.15 < e;
      const nsMin = v + 0.15 < n && v + 0.15 < s;
      // True elongated trough — not a closed low centre
      if ((ewMin || nsMin) && !(ewMin && nsMin)) {
        const mean = (w + e + n + s) / 4;
        const d = mean - v;
        if (d >= 1.0) {
          mask[r * cols + c] = 1;
          depth[r * cols + c] = d;
        }
      }
    }
  }

  const seeds: Array<{ r: number; c: number; score: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (mask[i]) seeds.push({ r, c, score: depth[i]! });
    }
  }
  seeds.sort((a, b) => b.score - a.score);

  const used = new Uint8Array(rows * cols);
  const lines: [number, number][][] = [];

  for (const seed of seeds.slice(0, 25)) {
    if (used[seed.r * cols + seed.c]) continue;
    // Walk along elongated axis: prefer neighbors that are also trough cells
    const pts: [number, number][] = [];
    let r = seed.r;
    let c = seed.c;
    for (let stepN = 0; stepN < 60; stepN++) {
      const i = r * cols + c;
      if (!mask[i] || used[i]) break;
      used[i] = 1;
      pts.push([lonAt(field, c), latAt(field, r)]);
      let best: { r: number; c: number; score: number } | null = null;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (!mask[ni] || used[ni]) continue;
          // Prefer continuing in a straight elongated direction
          const score = depth[ni]!;
          if (!best || score > best.score) best = { r: nr, c: nc, score };
        }
      }
      if (!best) break;
      r = best.r;
      c = best.c;
    }
    if (pts.length >= 4 && lineLengthKm(pts) >= 800) {
      lines.push(smoothLine(pts, 2));
    }
  }

  // Keep at most 3 strongest (longest × depth)
  const scored = lines
    .map((coords) => ({
      coords,
      score: lineLengthKm(coords),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  void step;
  return scored.map(({ coords }) => ({
    type: "Feature" as const,
    properties: { kind: "trough" as const },
    geometry: { type: "LineString" as const, coordinates: coords },
  }));
}

export function detectFronts(field: SynopticField): FrontFeature[] {
  return [...detectThermalFronts(field), ...detectTroughs(field)];
}
