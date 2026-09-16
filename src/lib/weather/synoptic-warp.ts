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
 * Projection: south-polar stereographic (OpenCPN weatherfax MSLPC pole /
 * equator), with lon/mercY linear terms refit from coast tips on the current
 * 640×432 chart crop (see synoptic-fit.json). Affine land-mask fits lock the
 * Bight well but leave Cape York / Tasmania drifted; polar keeps extremes
 * closer to the GeoJSON outline.
 */

function latToMercY(latDeg: number) {
  const s = Math.sin((latDeg * Math.PI) / 180);
  return 0.5 * Math.log((1 + s) / (1 - s));
}

function mercYToLat(y: number) {
  return (180 / Math.PI) * (2 * Math.atan(Math.exp(y)) - Math.PI / 2);
}

type Calib = {
  a: number;
  b: number;
  c: number;
  d: number;
  poleX: number;
  poleY: number;
  inputheight: number;
  trueRatio: number;
  imgW: number;
  imgH: number;
};

function buildCalibration(imgW: number, imgH: number): Calib {
  const sx = imgW / fit.chartW;
  const sy = imgH / fit.chartH;
  return {
    a: fit.a,
    b: fit.b,
    c: fit.c,
    d: fit.d,
    poleX: fit.poleX * sx,
    poleY: fit.poleY * sy,
    inputheight: (fit.inputEquator - fit.poleY) * sy,
    trueRatio: fit.trueRatio,
    imgW,
    imgH,
  };
}

function latLonToInput(lat: number, lon: number, calib: Calib) {
  const geoY = latToMercY(lat);
  const mx = (lon - calib.b) / calib.a;
  let my = (geoY - calib.d) / calib.c;
  my /= calib.imgH;
  const pp = (4 / Math.PI) * Math.atan(Math.exp(my)) - 1;
  const q = calib.inputheight > 0 ? 1 + pp : 1 - pp;
  const z = Math.tan((q * Math.PI) / 4);
  const dist = z * calib.inputheight;
  const theta = mx / calib.imgW;
  let dx = Math.abs(dist) * Math.sin(theta);
  const dy = dist * Math.cos(theta);
  dx /= calib.trueRatio;
  return { px: dx + calib.poleX, py: dy + calib.poleY };
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
  const calib = buildCalibration(src.width, src.height);
  const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
  const outW = GIBS_DISPLAY_WIDTH;
  const outH = Math.max(1, Math.round(outW / GIBS_AU_ASPECT));
  const out = new PNG({ width: outW, height: outH });
  const myNorth = latToMercY(north);
  const mySouth = latToMercY(south);
  // Hide the chart legend strip along the bottom of the source PNG.
  const legendTop = src.height * (1 - 70 / fit.chartH);

  // Small mercator-pixel nudge after polar (tuned against GeoJSON coast).
  const nudgeX = (fit as { nudgeX?: number }).nudgeX ?? 0;
  const nudgeY = (fit as { nudgeY?: number }).nudgeY ?? 0;

  for (let j = 0; j < outH; j++) {
    const my =
      myNorth + ((j + 0.5 - nudgeY) / outH) * (mySouth - myNorth);
    const lat = mercYToLat(my);
    for (let i = 0; i < outW; i++) {
      const lon = west + ((i + 0.5 - nudgeX) / outW) * (east - west);
      const { px, py } = latLonToInput(lat, lon, calib);
      const o = (j * outW + i) * 4;
      if (py >= legendTop) {
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
