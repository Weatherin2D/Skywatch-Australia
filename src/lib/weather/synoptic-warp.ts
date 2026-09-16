import { PNG } from "pngjs";
import {
  GIBS_AU_ASPECT,
  GIBS_AU_BOUNDS,
  GIBS_DISPLAY_WIDTH,
} from "@/lib/weather/maps";

/**
 * OpenCPN weatherfax GCPs for BoM colour MSLP (IDY00030 / MSLPC).
 * Polar stereographic mapping — see weatherfax_pi CoordinateSets.xml.
 */
const FAX = {
  width: 640,
  height: 432,
  poleX: 293,
  poleY: 1040,
  inputEquator: -831,
  trueRatio: 1,
  /** Input pixels ↔ geographic control points */
  g1: { px: 287, py: 206, lat: -50, lon: 130 },
  g2: { px: 117, py: 24, lat: -10, lon: 100 },
} as const;

function latToMercY(latDeg: number) {
  const s = Math.sin((latDeg * Math.PI) / 180);
  return 0.5 * Math.log((1 + s) / (1 - s));
}

function mercYToLat(y: number) {
  return (180 / Math.PI) * (2 * Math.atan(Math.exp(y)) - Math.PI / 2);
}

function inputToMercRaw(px: number, py: number, imgW: number, imgH: number) {
  const inputheight = FAX.inputEquator - FAX.poleY;
  let dx = (px - FAX.poleX) * FAX.trueRatio;
  const dy = py - FAX.poleY;
  const theta = Math.atan2(dx, Math.abs(dy));
  const x = theta * imgW;
  const z = Math.hypot(dx, dy) / inputheight;
  const q = (4 / Math.PI) * Math.atan(z);
  const pp = q + (inputheight > 0 ? -1 : 1);
  const s = Math.sin(pp * (Math.PI / 2));
  const y = 0.5 * Math.log((1 + s) / (1 - s)) * imgH;
  return { x, y };
}

type Calib = {
  a: number;
  b: number;
  c: number;
  d: number;
  imgW: number;
  imgH: number;
  inputheight: number;
};

function buildCalibration(imgW: number, imgH: number): Calib {
  const inputheight = FAX.inputEquator - FAX.poleY;
  const g1m = inputToMercRaw(FAX.g1.px, FAX.g1.py, imgW, imgH);
  const g2m = inputToMercRaw(FAX.g2.px, FAX.g2.py, imgW, imgH);
  const g1my = latToMercY(FAX.g1.lat);
  const g2my = latToMercY(FAX.g2.lat);
  const a = (FAX.g2.lon - FAX.g1.lon) / (g2m.x - g1m.x);
  const b = FAX.g1.lon - a * g1m.x;
  const c = (g2my - g1my) / (g2m.y - g1m.y);
  const d = g1my - c * g1m.y;
  return { a, b, c, d, imgW, imgH, inputheight };
}

function latLonToInput(lat: number, lon: number, calib: Calib) {
  const geoY = latToMercY(lat);
  const mx = (lon - calib.b) / calib.a;
  let my = (geoY - calib.d) / calib.c;
  my /= calib.imgH;
  const pp = (4 / Math.PI) * Math.atan(Math.exp(my)) - 1;
  const q =
    calib.inputheight > 0 ? 1 + pp : 1 - pp;
  const z = Math.tan((q * Math.PI) / 4);
  const dist = z * calib.inputheight;
  const theta = mx / calib.imgW;
  let dx = Math.abs(dist) * Math.sin(theta);
  const dy = dist * Math.cos(theta);
  dx /= FAX.trueRatio;
  return { px: dx + FAX.poleX, py: dy + FAX.poleY };
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
 * Warp BoM polar-stereographic MSLP PNG into Web Mercator covering
 * GIBS_AU_BOUNDS so ImageOverlay / satellite object-fill align with coasts.
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

  for (let j = 0; j < outH; j++) {
    const my = myNorth + ((j + 0.5) / outH) * (mySouth - myNorth);
    const lat = mercYToLat(my);
    for (let i = 0; i < outW; i++) {
      const lon = west + ((i + 0.5) / outW) * (east - west);
      const { px, py } = latLonToInput(lat, lon, calib);
      const rgb = sampleBilinear(src.data as Buffer, src.width, src.height, px, py);
      const o = (j * outW + i) * 4;
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
