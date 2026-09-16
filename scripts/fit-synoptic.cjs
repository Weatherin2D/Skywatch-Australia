/**
 * Register BoM IDY00030 colour MSLP against the national Australia outline.
 *
 * Fits south-polar stereographic linear terms (a,b,c,d) from coast-tip GCPs
 * on the current 640×432 chart crop, keeping OpenCPN MSLPC pole/equator.
 * Writes src/lib/weather/synoptic-fit.json (imported by synoptic-warp.ts).
 *
 * Usage: node scripts/fit-synoptic.cjs [/path/to/IDY00030.png]
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const chartPath = process.argv[2] || "/tmp/synoptic.png";
const src = PNG.sync.read(fs.readFileSync(chartPath));
const W = src.width;
const H = src.height;

// OpenCPN weatherfax "Australia BOM - Australia - MSLPC" pole geometry.
const poleX = 293;
const poleY = 1040;
const inputEquator = -831;
const trueRatio = 1;

// Coast tips on the current IDY00030 crop (beige mainland after morph-close).
const GCPS = [
  { px: 406, py: 17, lon: 142.53, lat: -10.69, name: "CapeYork" },
  { px: 162, py: 124, lon: 113.16, lat: -26.15, name: "SteepPoint" },
  { px: 473, py: 159, lon: 153.64, lat: -28.64, name: "CapeByron" },
  { px: 404, py: 265, lon: 146.83, lat: -43.64, name: "SouthEastCape" },
  { px: 189, py: 209, lon: 115.14, lat: -34.37, name: "CapeLeeuwin" },
  { px: 169, py: 118, lon: 114.17, lat: -21.79, name: "NorthwestCape" },
];

function latToMercY(latDeg) {
  const s = Math.sin((latDeg * Math.PI) / 180);
  return 0.5 * Math.log((1 + s) / (1 - s));
}

function mercYToLat(y) {
  return (180 / Math.PI) * (2 * Math.atan(Math.exp(y)) - Math.PI / 2);
}

function inputToMercRaw(px, py) {
  const inputheight = inputEquator - poleY;
  const dx = (px - poleX) * trueRatio;
  const dy = py - poleY;
  const theta = Math.atan2(dx, Math.abs(dy));
  const x = theta * W;
  const z = Math.hypot(dx, dy) / inputheight;
  const q = (4 / Math.PI) * Math.atan(z);
  const pp = q + (inputheight > 0 ? -1 : 1);
  const s = Math.sin(pp * (Math.PI / 2));
  const y = 0.5 * Math.log((1 + s) / (1 - s)) * H;
  return { x, y };
}

const ms = GCPS.map((p) => ({
  ...p,
  m: inputToMercRaw(p.px, p.py),
  my: latToMercY(p.lat),
}));
const n = ms.length;
let sX = 0;
let sY = 0;
let sXX = 0;
let sXY = 0;
let sYr = 0;
let sYY = 0;
let sXY2 = 0;
let sYYr = 0;
for (const p of ms) {
  sX += p.m.x;
  sY += p.lon;
  sXX += p.m.x * p.m.x;
  sXY += p.m.x * p.lon;
  sYr += p.m.y;
  sYY += p.my;
  sXY2 += p.m.y * p.my;
  sYYr += p.m.y * p.m.y;
}
const a = (n * sXY - sX * sY) / (n * sXX - sX * sX);
const b = (sY - a * sX) / n;
const c = (n * sXY2 - sYr * sYY) / (n * sYYr - sYr * sYr);
const d = (sYY - c * sYr) / n;

let err = 0;
for (const p of ms) {
  const lon = a * p.m.x + b;
  const lat = mercYToLat(c * p.m.y + d);
  const e = Math.hypot(lon - p.lon, lat - p.lat);
  err += e * e;
  console.log(
    p.name,
    "->",
    lon.toFixed(2),
    lat.toFixed(2),
    "want",
    p.lon,
    p.lat,
    "err°",
    e.toFixed(2),
  );
}
console.log("rms°", Math.sqrt(err / n));

// Empirical mercator-pixel nudge (positive Y moves chart content south).
const nudgeX = 0;
const nudgeY = -20;

const params = {
  mode: "polar_gcp",
  poleX,
  poleY,
  inputEquator,
  trueRatio,
  a,
  b,
  c,
  d,
  nudgeX,
  nudgeY,
  chartW: W,
  chartH: H,
  gcps: GCPS,
  notes:
    "OpenCPN MSLPC pole/equator; a,b,c,d from coast tips; nudgeY shifts overlay north to match GeoJSON.",
};

const outPath = path.join(__dirname, "../src/lib/weather/synoptic-fit.json");
fs.writeFileSync(outPath, JSON.stringify(params, null, 2));
console.log("wrote", outPath);

// Optional diagnostic overlay against australia-outline.geojson
try {
  const geo = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../public/geo/australia-outline.geojson"),
      "utf8",
    ),
  );
  function lonLatToWebMercator(lon, lat) {
    const x = (lon * 20037508.34) / 180;
    let y =
      Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    y = (y * 20037508.34) / 180;
    return [x, y];
  }
  const south = -48;
  const west = 105;
  const north = -5;
  const east = 165;
  const [minX, minY] = lonLatToWebMercator(west, south);
  const [maxX, maxY] = lonLatToWebMercator(east, north);
  const outW = 1024;
  const outH = Math.round(outW / ((maxX - minX) / (maxY - minY)));
  const inputheight = inputEquator - poleY;
  function latLonToInput(lat, lon) {
    const geoY = latToMercY(lat);
    const mx = (lon - b) / a;
    let my = (geoY - d) / c;
    my /= H;
    const pp = (4 / Math.PI) * Math.atan(Math.exp(my)) - 1;
    const q = inputheight > 0 ? 1 + pp : 1 - pp;
    const z = Math.tan((q * Math.PI) / 4);
    const dist = z * inputheight;
    const theta = mx / W;
    let dx = Math.abs(dist) * Math.sin(theta);
    const dy = dist * Math.cos(theta);
    dx /= trueRatio;
    return { px: dx + poleX, py: dy + poleY };
  }
  const myN = latToMercY(north);
  const myS = latToMercY(south);
  const out = new PNG({ width: outW, height: outH });
  for (let j = 0; j < outH; j++) {
    for (let i = 0; i < outW; i++) {
      const lon = west + ((i + 0.5 - nudgeX) / outW) * (east - west);
      const my = myN + ((j + 0.5 - nudgeY) / outH) * (myS - myN);
      const lat = mercYToLat(my);
      const { px, py } = latLonToInput(lat, lon);
      const o = (j * outW + i) * 4;
      if (px < 0 || py < 0 || px >= W - 1 || py >= H - 1 || py >= H - 70) {
        out.data[o + 3] = 0;
        continue;
      }
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const dx = px - x0;
      const dy = py - y0;
      const idx = (ix, iy) => (iy * W + ix) * 4;
      const c00 = idx(x0, y0);
      const c10 = idx(x0 + 1, y0);
      const c01 = idx(x0, y0 + 1);
      const c11 = idx(x0 + 1, y0 + 1);
      for (let k = 0; k < 3; k++) {
        out.data[o + k] = Math.round(
          src.data[c00 + k] * (1 - dx) * (1 - dy) +
            src.data[c10 + k] * dx * (1 - dy) +
            src.data[c01 + k] * (1 - dx) * dy +
            src.data[c11 + k] * dx * dy,
        );
      }
      out.data[o + 3] = 255;
    }
  }
  function strokePoly(pts) {
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const steps = Math.max(2, Math.hypot(x2 - x1, y2 - y1) | 0);
      for (let t = 0; t <= steps; t++) {
        const x = Math.round(x1 + ((x2 - x1) * t) / steps);
        const y = Math.round(y1 + ((y2 - y1) * t) / steps);
        if (x < 0 || y < 0 || x >= outW || y >= outH) continue;
        const o = (y * outW + x) * 4;
        out.data[o] = 255;
        out.data[o + 1] = 0;
        out.data[o + 2] = 0;
        out.data[o + 3] = 255;
      }
    }
  }
  function toPix(lon, lat) {
    const [x, y] = lonLatToWebMercator(lon, lat);
    return [
      ((x - minX) / (maxX - minX)) * outW,
      ((maxY - y) / (maxY - minY)) * outH,
    ];
  }
  for (const f of geo.features || [geo]) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      strokePoly(poly[0].map(([lon, lat]) => toPix(lon, lat)));
    }
  }
  const art = "/opt/cursor/artifacts/synoptic-polar-gcp-overlay.png";
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync(art, PNG.sync.write(out));
  console.log("wrote", art);
} catch (err) {
  console.warn("overlay skipped", err.message);
}
