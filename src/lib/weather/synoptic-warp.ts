import { PNG } from "pngjs";
import {
  GIBS_AU_ASPECT,
  GIBS_AU_BOUNDS,
  GIBS_DISPLAY_WIDTH,
} from "@/lib/weather/maps";
import fit from "@/lib/weather/synoptic-fit.json";

/**
 * BoM colour MSLP (IDY00030) → national GIBS Mercator frame.
 *
 * Thin-plate spline maps each mercator overlay pixel to a source chart pixel
 * using coast-tip control points (see synoptic-fit.json). This locks Cape York,
 * the Bight, WA, and Tasmania far better than a single polar/affine model.
 */

type Tps = {
  w: number[];
  a0: number;
  a1: number;
  a2: number;
};

type Ctrl = { mx: number; my: number; px: number; py: number };

const CTRLS = fit.ctrls as Ctrl[];
const TPS_X = fit.tpsX as Tps;
const TPS_Y = fit.tpsY as Tps;
const FIT_OUT_W = fit.outW;
const FIT_OUT_H = fit.outH;
const FIT_CHART_W = fit.chartW;
const FIT_CHART_H = fit.chartH;

function U(r2: number) {
  if (r2 < 1e-12) return 0;
  const r = Math.sqrt(r2);
  return r2 * Math.log(r);
}

function mapTps(mx: number, my: number, tps: Tps) {
  let v = tps.a0 + tps.a1 * mx + tps.a2 * my;
  for (let i = 0; i < CTRLS.length; i++) {
    const dx = mx - CTRLS[i]!.mx;
    const dy = my - CTRLS[i]!.my;
    v += tps.w[i]! * U(dx * dx + dy * dy);
  }
  return v;
}

function sampleBilinear(
  data: Buffer,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number] | null {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const dx = x - x0;
  const dy = y - y0;
  const idx = (ix: number, iy: number) => (iy * w + ix) * 4;
  const c00 = idx(x0, y0);
  const c10 = idx(x1, y0);
  const c01 = idx(x0, y1);
  const c11 = idx(x1, y1);
  const r =
    data[c00]! * (1 - dx) * (1 - dy) +
    data[c10]! * dx * (1 - dy) +
    data[c01]! * (1 - dx) * dy +
    data[c11]! * dx * dy;
  const g =
    data[c00 + 1]! * (1 - dx) * (1 - dy) +
    data[c10 + 1]! * dx * (1 - dy) +
    data[c01 + 1]! * (1 - dx) * dy +
    data[c11 + 1]! * dx * dy;
  const b =
    data[c00 + 2]! * (1 - dx) * (1 - dy) +
    data[c10 + 2]! * dx * (1 - dy) +
    data[c01 + 2]! * (1 - dx) * dy +
    data[c11 + 2]! * dx * dy;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/**
 * Warp BoM MSLP PNG into Web Mercator covering GIBS_AU_BOUNDS so ImageOverlay
 * / satellite object-fit align with the national coast outline.
 */
export function warpSynopticToGibsMercator(sourcePng: Buffer): Buffer {
  const src = PNG.sync.read(sourcePng);
  const outW = GIBS_DISPLAY_WIDTH;
  const outH = Math.max(1, Math.round(outW / GIBS_AU_ASPECT));
  const out = new PNG({ width: outW, height: outH });

  const sxOut = outW / FIT_OUT_W;
  const syOut = outH / FIT_OUT_H;
  const sxChart = src.width / FIT_CHART_W;
  const syChart = src.height / FIT_CHART_H;
  const legendTop = src.height * (1 - 70 / FIT_CHART_H);

  for (let j = 0; j < outH; j++) {
    const myFit = (j + 0.5) / syOut;
    for (let i = 0; i < outW; i++) {
      const mxFit = (i + 0.5) / sxOut;
      const px = mapTps(mxFit, myFit, TPS_X) * sxChart;
      const py = mapTps(mxFit, myFit, TPS_Y) * syChart;
      const o = (j * outW + i) * 4;
      if (!Number.isFinite(px) || !Number.isFinite(py) || py >= legendTop) {
        out.data[o] = 0;
        out.data[o + 1] = 0;
        out.data[o + 2] = 0;
        out.data[o + 3] = 0;
        continue;
      }
      const rgb = sampleBilinear(
        src.data as Buffer,
        src.width,
        src.height,
        px,
        py,
      );
      if (!rgb) {
        out.data[o] = 0;
        out.data[o + 1] = 0;
        out.data[o + 2] = 0;
        out.data[o + 3] = 0;
      } else {
        out.data[o] = rgb[0];
        out.data[o + 1] = rgb[1];
        out.data[o + 2] = rgb[2];
        out.data[o + 3] = 255;
      }
    }
  }

  return PNG.sync.write(out);
}

/** Geographic bounds for the warped overlay (matches national satellite frame). */
export const SYNOPTIC_OVERLAY_BOUNDS = GIBS_AU_BOUNDS;
