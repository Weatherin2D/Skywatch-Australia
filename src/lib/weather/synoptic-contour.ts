/**
 * Marching-squares isobars + H/L centres from a synoptic pressure field.
 * Fronts come from BoM IDY00030 (see bom-fronts.ts) and are merged by the API.
 */

import type { PressureGrid, SynopticField } from "@/lib/weather/synoptic-grid";

export type SynopticGeoJson = {
  type: "FeatureCollection";
  features: SynopticFeature[];
};

export type FrontKind =
  | "cold_front"
  | "warm_front"
  | "stationary_front"
  | "occluded_front"
  | "trough";

export type SynopticFeature =
  | {
      type: "Feature";
      properties: {
        kind: "isobar";
        pressure: number;
      };
      geometry: {
        type: "LineString";
        coordinates: [number, number][];
      };
    }
  | {
      type: "Feature";
      properties: {
        kind: "high" | "low";
        pressure: number;
        label: string;
      };
      geometry: {
        type: "Point";
        coordinates: [number, number];
      };
    }
  | {
      type: "Feature";
      properties: {
        kind: FrontKind;
        /** Unit vector toward warmer air (east, north) — for barb orientation. */
        warmSide?: [number, number];
      };
      geometry: {
        type: "LineString";
        coordinates: [number, number][];
      };
    };

function at(grid: PressureGrid, row: number, col: number): number {
  if (row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) {
    return Number.NaN;
  }
  return grid.values[row * grid.cols + col]!;
}

function lonAt(grid: PressureGrid, col: number): number {
  return grid.west + col * grid.step;
}

function latAt(grid: PressureGrid, row: number): number {
  // row 0 = north
  return grid.south + (grid.rows - 1 - row) * grid.step;
}

function lerp(
  a: number,
  b: number,
  va: number,
  vb: number,
  level: number,
): number {
  if (Math.abs(vb - va) < 1e-9) return (a + b) / 2;
  return a + ((level - va) / (vb - va)) * (b - a);
}

/**
 * Contour one pressure level. Coordinates are [lon, lat].
 */
function contourLevel(grid: PressureGrid, level: number): [number, number][][] {
  type Pt = [number, number];
  const segments: Array<[Pt, Pt]> = [];

  for (let r = 0; r < grid.rows - 1; r++) {
    for (let c = 0; c < grid.cols - 1; c++) {
      const v00 = at(grid, r, c);
      const v10 = at(grid, r, c + 1);
      const v01 = at(grid, r + 1, c);
      const v11 = at(grid, r + 1, c + 1);
      if (
        !Number.isFinite(v00) ||
        !Number.isFinite(v10) ||
        !Number.isFinite(v01) ||
        !Number.isFinite(v11)
      ) {
        continue;
      }

      let code = 0;
      if (v00 >= level) code |= 1;
      if (v10 >= level) code |= 2;
      if (v11 >= level) code |= 4;
      if (v01 >= level) code |= 8;
      if (code === 0 || code === 15) continue;

      const lon0 = lonAt(grid, c);
      const lon1 = lonAt(grid, c + 1);
      const lat0 = latAt(grid, r);
      const lat1 = latAt(grid, r + 1);

      const top: Pt = [lerp(lon0, lon1, v00, v10, level), lat0];
      const bottom: Pt = [lerp(lon0, lon1, v01, v11, level), lat1];
      const left: Pt = [lon0, lerp(lat0, lat1, v00, v01, level)];
      const right: Pt = [lon1, lerp(lat0, lat1, v10, v11, level)];

      const edge = (mask: number): [Pt, Pt] | null => {
        switch (mask) {
          case 1:
          case 14:
            return [left, top];
          case 2:
          case 13:
            return [top, right];
          case 3:
          case 12:
            return [left, right];
          case 4:
          case 11:
            return [right, bottom];
          case 6:
          case 9:
            return [top, bottom];
          case 7:
          case 8:
            return [left, bottom];
          case 5: {
            // Saddle — average disambiguation
            const avg = (v00 + v10 + v01 + v11) / 4;
            return avg >= level
              ? [left, top]
              : [bottom, right];
          }
          case 10: {
            const avg = (v00 + v10 + v01 + v11) / 4;
            return avg >= level
              ? [top, right]
              : [left, bottom];
          }
          default:
            return null;
        }
      };

      if (code === 5 || code === 10) {
        const avg = (v00 + v10 + v01 + v11) / 4;
        if (code === 5) {
          if (avg >= level) {
            segments.push([left, top], [bottom, right]);
          } else {
            segments.push([left, bottom], [top, right]);
          }
        } else if (avg >= level) {
          segments.push([top, right], [left, bottom]);
        } else {
          segments.push([left, top], [right, bottom]);
        }
        continue;
      }

      const seg = edge(code);
      if (seg) segments.push(seg);
    }
  }

  return stitch(segments);
}

function near(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

function stitch(
  segments: Array<[[number, number], [number, number]]>,
): [number, number][][] {
  const unused = segments.map((s) => [...s] as [[number, number], [number, number]]);
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

function findCentres(grid: PressureGrid): SynopticFeature[] {
  const out: SynopticFeature[] = [];
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      const v = at(grid, r, c);
      if (!Number.isFinite(v)) continue;
      let isMax = true;
      let isMin = true;
      let neighSum = 0;
      let neighN = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const n = at(grid, r + dr, c + dc);
          if (!Number.isFinite(n)) {
            isMax = false;
            isMin = false;
            continue;
          }
          neighSum += n;
          neighN++;
          if (n >= v) isMax = false;
          if (n <= v) isMin = false;
        }
      }
      if (!neighN) continue;
      const mean = neighSum / neighN;
      if (isMax && v - mean >= 1.2) {
        out.push({
          type: "Feature",
          properties: {
            kind: "high",
            pressure: Math.round(v),
            label: "H",
          },
          geometry: {
            type: "Point",
            coordinates: [lonAt(grid, c), latAt(grid, r)],
          },
        });
      } else if (isMin && mean - v >= 1.2) {
        out.push({
          type: "Feature",
          properties: {
            kind: "low",
            pressure: Math.round(v),
            label: "L",
          },
          geometry: {
            type: "Point",
            coordinates: [lonAt(grid, c), latAt(grid, r)],
          },
        });
      }
    }
  }
  return out;
}

/** Classic 4 hPa isobar spacing + H/L centres (fronts added by the API). */
export function contourPressureGrid(
  grid: PressureGrid | SynopticField,
  interval = 4,
): SynopticGeoJson {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i]!;
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { type: "FeatureCollection", features: [] };
  }

  const start = Math.ceil(min / interval) * interval;
  const features: SynopticFeature[] = [];

  for (let level = start; level <= max; level += interval) {
    const lines = contourLevel(grid, level);
    for (const coords of lines) {
      if (coords.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { kind: "isobar", pressure: level },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
  }

  features.push(...findCentres(grid));

  return { type: "FeatureCollection", features };
}
