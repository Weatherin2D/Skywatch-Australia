import { PNG } from "pngjs";
import {
  GIBS_AU_ASPECT,
  GIBS_AU_BOUNDS,
  GIBS_DISPLAY_WIDTH,
} from "@/lib/weather/maps";
import fit from "@/lib/weather/synoptic-fit.json";

/**
 * Empirical registration of BoM colour MSLP (IDY00030) into the national
 * GIBS Mercator frame. OpenCPN polar GCPs do not match the current chart
 * crop; instead we bake a mainland land-mask similarity fit (see
 * scripts/fit-synoptic.cjs).
 *
 * Mapping (chart px → mercator overlay px):
 *   ox = scX * (x - chartCx) + tx
 *   oy = scY * (y - chartCy) + ty
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
 * Warp BoM MSLP PNG into Web Mercator covering GIBS_AU_BOUNDS so ImageOverlay
 * / satellite object-fit align with the national coast outline.
 */
export function warpSynopticToGibsMercator(sourcePng: Buffer): Buffer {
  const src = PNG.sync.read(sourcePng);
  const outW = GIBS_DISPLAY_WIDTH;
  const outH = Math.max(1, Math.round(outW / GIBS_AU_ASPECT));
  const out = new PNG({ width: outW, height: outH });

  // Scale fit (computed at FIT.chartW×FIT.chartH → FIT.outW×FIT.outH) if the
  // upstream PNG or display size differs slightly.
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

  // Skip the chart legend strip (bottom ~16% on the reference 432-tall PNG).
  const legendTop = src.height * (1 - 70 / FIT.chartH);

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

/** Geographic bounds for the warped overlay (matches national satellite frame). */
export const SYNOPTIC_OVERLAY_BOUNDS = GIBS_AU_BOUNDS;
