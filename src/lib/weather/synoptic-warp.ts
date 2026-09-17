import { PNG } from "pngjs";
import {
  GIBS_AU_ASPECT,
  GIBS_AU_BOUNDS,
  GIBS_DISPLAY_WIDTH,
} from "@/lib/weather/maps";
import fit from "@/lib/weather/synoptic-fit.json";

/**
 * BoM colour MSLP (IDY00030) → national GIBS frame.
 *
 * Uniform horizontal/vertical stretch only — no polar remapping or TPS.
 * Keeps isobars and labels sharp while sizing the whole chart to the
 * national Australia outline (see synoptic-fit.json).
 */

const FIT = {
  scX: fit.scX,
  scY: fit.scY,
  tx: fit.tx,
  ty: fit.ty,
  chartCx: fit.chartCx,
  chartCy: fit.chartCy,
  chartW: fit.chartW,
  chartH: fit.chartH,
  legendH: fit.legendH ?? 70,
  outW: fit.outW,
  outH: fit.outH,
} as const;

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
 * Stretch the BoM chart into the national overlay frame with independent
 * X/Y scale (no sectional warp).
 */
export function warpSynopticToGibsMercator(sourcePng: Buffer): Buffer {
  const src = PNG.sync.read(sourcePng);
  const outW = GIBS_DISPLAY_WIDTH;
  const outH = Math.max(1, Math.round(outW / GIBS_AU_ASPECT));
  const out = new PNG({ width: outW, height: outH });

  const sxChart = src.width / FIT.chartW;
  const syChart = src.height / FIT.chartH;
  const sxOut = outW / FIT.outW;
  const syOut = outH / FIT.outH;

  const scX = FIT.scX * (sxOut / sxChart);
  const scY = FIT.scY * (syOut / syChart);
  const tx = FIT.tx * sxOut;
  const ty = FIT.ty * syOut;
  const cx = FIT.chartCx * sxChart;
  const cy = FIT.chartCy * syChart;
  const legendTop = src.height * (1 - FIT.legendH / FIT.chartH);

  for (let j = 0; j < outH; j++) {
    for (let i = 0; i < outW; i++) {
      const x = (i + 0.5 - tx) / scX + cx;
      const y = (j + 0.5 - ty) / scY + cy;
      const o = (j * outW + i) * 4;
      if (y >= legendTop) {
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
        x,
        y,
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

/** Geographic bounds for the overlay (matches national satellite frame). */
export const SYNOPTIC_OVERLAY_BOUNDS = GIBS_AU_BOUNDS;
