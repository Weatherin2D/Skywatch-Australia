/**
 * Derive synoptic fronts / troughs from temperature + wind + MSLP grids.
 *
 * Thermal fronts: ridges of strong |∇T|, classified by temperature advection.
 * Troughs: elongated MSLP minima axes (N–S / E–W).
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
  return arr[row * cols + col]!;
}

function lonAt(field: SynopticField, col: number): number {
  return field.west + col * field.step;
}

function latAt(field: SynopticField, row: number): number {
  return field.south + (field.rows - 1 - row) * field.step;
}

function near(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
}

function stitch(
  segments: Array<[[number, number], [number, number]]>,
): [number, number][][] {
  const unused = segments.map(
    (s) => [...s] as [[number, number], [number, number]],
  );
  const lines: [number, number][][] = [];
  while (unused.length) {
    const first = unused.pop()!;
    const line: [number, number][] = [first[0], first[1]];
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = unused.length - 1; i >= 0; i--) {
        const [a, b] = unused[i]!;
        const head = line[0]!;
        const tail = line[line.length - 1]!;
        if (near(tail, a)) {
          line.push(b);
          unused.splice(i, 1);
          extended = true;
        } else if (near(tail, b)) {
          line.push(a);
          unused.splice(i, 1);
          extended = true;
        } else if (near(head, b)) {
          line.unshift(a);
          unused.splice(i, 1);
          extended = true;
        } else if (near(head, a)) {
          line.unshift(b);
          unused.splice(i, 1);
          extended = true;
        }
      }
    }
    if (line.length >= 2) lines.push(line);
  }
  return lines;
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

function sampleAlong(
  field: SynopticField,
  arr: Float64Array,
  lon: number,
  lat: number,
): number {
  const col = (lon - field.west) / field.step;
  const row = (field.south + (field.rows - 1) * field.step - lat) / field.step;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  if (c0 < 0 || r0 < 0 || c0 >= field.cols - 1 || r0 >= field.rows - 1) {
    const c = Math.max(0, Math.min(field.cols - 1, Math.round(col)));
    const r = Math.max(0, Math.min(field.rows - 1, Math.round(row)));
    return at(arr, field.cols, r, c);
  }
  const fc = col - c0;
  const fr = row - r0;
  const v00 = at(arr, field.cols, r0, c0);
  const v10 = at(arr, field.cols, r0, c0 + 1);
  const v01 = at(arr, field.cols, r0 + 1, c0);
  const v11 = at(arr, field.cols, r0 + 1, c0 + 1);
  if (
    ![v00, v10, v01, v11].every(Number.isFinite)
  ) {
    return Number.NaN;
  }
  return (
    v00 * (1 - fc) * (1 - fr) +
    v10 * fc * (1 - fr) +
    v01 * (1 - fc) * fr +
    v11 * fc * fr
  );
}

/** Meteorological wind FROM deg → eastward/northward components (m/s). */
function windUV(speed: number, fromDeg: number): [number, number] {
  const rad = (fromDeg * Math.PI) / 180;
  // From direction: blowing from that azimuth → toward is opposite
  const u = -Math.sin(rad) * speed;
  const v = -Math.cos(rad) * speed;
  return [u, v];
}

function detectThermalFronts(field: SynopticField): FrontFeature[] {
  const { rows, cols, step } = field;
  const dTdx = new Float64Array(rows * cols);
  const dTdy = new Float64Array(rows * cols);
  const mag = new Float64Array(rows * cols);
  const mags: number[] = [];

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const lat = latAt(field, r) * (Math.PI / 180);
      const cos = Math.max(0.2, Math.cos(lat));
      const dxKm = step * 111.32 * cos;
      const dyKm = step * 111.32;
      const tE = at(field.temperatureC, cols, r, c + 1);
      const tW = at(field.temperatureC, cols, r, c - 1);
      const tN = at(field.temperatureC, cols, r - 1, c);
      const tS = at(field.temperatureC, cols, r + 1, c);
      if (![tE, tW, tN, tS].every(Number.isFinite)) continue;
      const gx = (tE - tW) / (2 * dxKm); // °C / km, eastward
      const gy = (tN - tS) / (2 * dyKm); // °C / km, northward
      const i = r * cols + c;
      dTdx[i] = gx;
      dTdy[i] = gy;
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      mags.push(m);
    }
  }
  if (mags.length < 20) return [];
  mags.sort((a, b) => a - b);
  const thresh = mags[Math.floor(mags.length * 0.68)]!;

  // Non-max suppression along gradient → ridge mask
  const ridge = new Uint8Array(rows * cols);
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      const i = r * cols + c;
      const m = mag[i]!;
      if (m < thresh) continue;
      const gx = dTdx[i]!;
      const gy = dTdy[i]!;
      const len = Math.hypot(gx, gy) || 1;
      const nx = gx / len;
      const ny = gy / len;
      // Step ~1 grid cell along gradient in index space
      const lat = latAt(field, r) * (Math.PI / 180);
      const cos = Math.max(0.2, Math.cos(lat));
      const dc = nx / (step * cos);
      const dr = -ny / step; // row increases south
      const r1 = Math.round(r + dr);
      const c1 = Math.round(c + dc);
      const r2 = Math.round(r - dr);
      const c2 = Math.round(c - dc);
      if (
        r1 < 0 ||
        c1 < 0 ||
        r1 >= rows ||
        c1 >= cols ||
        r2 < 0 ||
        c2 < 0 ||
        r2 >= rows ||
        c2 >= cols
      ) {
        continue;
      }
      if (m >= mag[r1 * cols + c1]! && m >= mag[r2 * cols + c2]!) {
        ridge[i] = 1;
      }
    }
  }

  // Link 8-connected ridge cells into polylines via neighbor segments
  const segments: Array<[[number, number], [number, number]]> = [];
  const seen = new Uint8Array(rows * cols);
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!ridge[i] || seen[i]) continue;
      // Walk a chain
      const pts: [number, number][] = [];
      let cr = r;
      let cc = c;
      let guard = 0;
      while (guard++ < 200) {
        const ci = cr * cols + cc;
        if (!ridge[ci] || seen[ci]) break;
        seen[ci] = 1;
        pts.push([lonAt(field, cc), latAt(field, cr)]);
        let next: [number, number] | null = null;
        let bestMag = -1;
        for (const [dr, dc] of dirs) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (!ridge[ni] || seen[ni]) continue;
          if (mag[ni]! > bestMag) {
            bestMag = mag[ni]!;
            next = [nr, nc];
          }
        }
        if (!next) break;
        cr = next[0];
        cc = next[1];
      }
      if (pts.length >= 2) {
        for (let k = 1; k < pts.length; k++) {
          segments.push([pts[k - 1]!, pts[k]!]);
        }
      }
    }
  }

  const lines = stitch(segments);
  const features: FrontFeature[] = [];

  for (const coords of lines) {
    if (lineLengthKm(coords) < 250) continue;

    // Mean temperature advection along the line: -V·∇T (°C/s proxy)
    let advSum = 0;
    let advN = 0;
    let warmSideDx = 0;
    let warmSideDy = 0;
    for (let i = 0; i < coords.length; i += Math.max(1, Math.floor(coords.length / 8))) {
      const [lon, lat] = coords[i]!;
      const col = Math.round((lon - field.west) / field.step);
      const row = Math.round(
        (field.south + (field.rows - 1) * field.step - lat) / field.step,
      );
      if (row < 1 || col < 1 || row >= rows - 1 || col >= cols - 1) continue;
      const idx = row * cols + col;
      const spd = at(field.windSpeed, cols, row, col);
      const from = at(field.windFromDeg, cols, row, col);
      if (!Number.isFinite(spd) || !Number.isFinite(from)) continue;
      const [u, v] = windUV(spd, from);
      // Convert °C/km advection to relative units
      const adv = -(u * dTdx[idx]! + v * dTdy[idx]!);
      advSum += adv;
      advN++;
      warmSideDx += dTdx[idx]!;
      warmSideDy += dTdy[idx]!;
    }
    if (!advN) continue;
    const meanAdv = advSum / advN;
    // Normalize warm-side pointer (toward warmer air = +∇T)
    const wLen = Math.hypot(warmSideDx, warmSideDy) || 1;

    let kind: "cold_front" | "warm_front" | "stationary_front";
    if (meanAdv < -0.008) kind = "cold_front";
    else if (meanAdv > 0.008) kind = "warm_front";
    else kind = "stationary_front";

    features.push({
      type: "Feature",
      properties: {
        kind,
        warmSide: [warmSideDx / wLen, warmSideDy / wLen],
      },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  return features;
}

function detectTroughs(field: SynopticField): FrontFeature[] {
  const { rows, cols, values } = field;
  const mask = new Uint8Array(rows * cols);

  // E–W trough axis: local min in row
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      const v = at(values, cols, r, c);
      if (!Number.isFinite(v)) continue;
      const w = at(values, cols, r, c - 1);
      const e = at(values, cols, r, c + 1);
      const n = at(values, cols, r - 1, c);
      const s = at(values, cols, r + 1, c);
      if (![w, e, n, s].every(Number.isFinite)) continue;
      const ewMin = v < w && v < e;
      const nsMin = v < n && v < s;
      // Elongated trough: min in one direction but not a closed low (not min in both)
      if ((ewMin || nsMin) && !(ewMin && nsMin)) {
        const mean = (w + e + n + s) / 4;
        if (mean - v >= 0.35) mask[r * cols + c] = 1;
      }
    }
  }

  const segments: Array<[[number, number], [number, number]]> = [];
  const seen = new Uint8Array(rows * cols);
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!mask[i] || seen[i]) continue;
      const pts: [number, number][] = [];
      let cr = r;
      let cc = c;
      let guard = 0;
      while (guard++ < 200) {
        const ci = cr * cols + cc;
        if (!mask[ci] || seen[ci]) break;
        seen[ci] = 1;
        pts.push([lonAt(field, cc), latAt(field, cr)]);
        let next: [number, number] | null = null;
        let best = Infinity;
        for (const [dr, dc] of dirs) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (!mask[ni] || seen[ni]) continue;
          const pv = at(values, cols, nr, nc);
          if (pv < best) {
            best = pv;
            next = [nr, nc];
          }
        }
        if (!next) break;
        cr = next[0];
        cc = next[1];
      }
      if (pts.length >= 2) {
        for (let k = 1; k < pts.length; k++) {
          segments.push([pts[k - 1]!, pts[k]!]);
        }
      }
    }
  }

  const features: FrontFeature[] = [];
  for (const coords of stitch(segments)) {
    if (lineLengthKm(coords) < 280) continue;
    features.push({
      type: "Feature",
      properties: { kind: "trough" },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return features;
}

export function detectFronts(field: SynopticField): FrontFeature[] {
  return [...detectThermalFronts(field), ...detectTroughs(field)];
}

/** Export sampleAlong for tests / symbol orientation helpers. */
export function frontWarmSideAt(
  field: SynopticField,
  lon: number,
  lat: number,
): [number, number] | null {
  const tE = sampleAlong(field, field.temperatureC, lon + field.step * 0.5, lat);
  const tW = sampleAlong(field, field.temperatureC, lon - field.step * 0.5, lat);
  const tN = sampleAlong(field, field.temperatureC, lon, lat + field.step * 0.5);
  const tS = sampleAlong(field, field.temperatureC, lon, lat - field.step * 0.5);
  if (![tE, tW, tN, tS].every(Number.isFinite)) return null;
  const gx = tE - tW;
  const gy = tN - tS;
  const len = Math.hypot(gx, gy) || 1;
  return [gx / len, gy / len];
}
