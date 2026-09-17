/**
 * Fit a uniform H/V stretch of BoM IDY00030 into the national GIBS frame.
 * Writes src/lib/weather/synoptic-fit.json for synoptic-warp.ts.
 *
 * Usage: node scripts/fit-synoptic.cjs [/path/to/IDY00030.png]
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const chartPath = process.argv[2] || "/tmp/synoptic.png";
const src = PNG.sync.read(fs.readFileSync(chartPath));
const geo = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../public/geo/australia-outline.geojson"),
    "utf8",
  ),
);
const W = src.width;
const H = src.height;
const legendH = 70;

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

const land = new Uint8Array(W * H);
for (let y = 0; y < H - legendH; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const r = src.data[i];
    const g = src.data[i + 1];
    const b = src.data[i + 2];
    if (r >= 238 && g >= 235 && b >= 210 && b <= 230 && Math.abs(r - g) < 8) {
      land[y * W + x] = 1;
    }
  }
}

function dilate(a, r) {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!a[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) o[ny * W + nx] = 1;
        }
      }
    }
  }
  return o;
}
function erode(a, r) {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !a[ny * W + nx]) {
            ok = 0;
            break;
          }
        }
      }
      o[y * W + x] = ok;
    }
  }
  return o;
}

const closed = erode(dilate(land, 2), 2);
const seen = new Uint8Array(W * H);
let largest = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i0 = y * W + x;
    if (!closed[i0] || seen[i0]) continue;
    const q = [[x, y]];
    seen[i0] = 1;
    const cells = [];
    while (q.length) {
      const [cx, cy] = q.pop();
      cells.push([cx, cy]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const i = ny * W + nx;
          if (seen[i] || !closed[i]) continue;
          seen[i] = 1;
          q.push([nx, ny]);
        }
      }
    }
    if (cells.length > largest.length) largest = cells;
  }
}

const mainland = new Uint8Array(W * H);
let sxSum = 0;
let sySum = 0;
let minx = W;
let miny = H;
let maxx = 0;
let maxy = 0;
for (const [x, y] of largest) {
  mainland[y * W + x] = 1;
  sxSum += x;
  sySum += y;
  minx = Math.min(minx, x);
  maxx = Math.max(maxx, x);
  miny = Math.min(miny, y);
  maxy = Math.max(maxy, y);
}
const cx = sxSum / largest.length;
const cy = sySum / largest.length;

const mask = new Uint8Array(outW * outH);
function fillPoly(pts) {
  let minYy = outH;
  let maxYy = 0;
  for (const p of pts) {
    minYy = Math.min(minYy, p[1]);
    maxYy = Math.max(maxYy, p[1]);
  }
  minYy = Math.max(0, Math.floor(minYy));
  maxYy = Math.min(outH - 1, Math.ceil(maxYy));
  for (let y = minYy; y <= maxYy; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(0, Math.floor(xs[i]));
      const b = Math.min(outW - 1, Math.ceil(xs[i + 1]));
      for (let x = a; x <= b; x++) mask[y * outW + x] = 1;
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
    fillPoly(poly[0].map(([lon, lat]) => toPix(lon, lat)));
  }
}

let mmx = 0;
let mmy = 0;
let mn = 0;
let mminx = outW;
let mminy = outH;
let mmaxx = 0;
let mmaxy = 0;
for (let y = 0; y < outH; y++) {
  for (let x = 0; x < outW; x++) {
    if (!mask[y * outW + x]) continue;
    mmx += x;
    mmy += y;
    mn++;
    mminx = Math.min(mminx, x);
    mmaxx = Math.max(mmaxx, x);
    mminy = Math.min(mminy, y);
    mmaxy = Math.max(mmaxy, y);
  }
}
const mtx = mmx / mn;
const mty = mmy / mn;
const sc0 = Math.sqrt(
  ((mmaxx - mminx) * (mmaxy - mminy)) / ((maxx - minx) * (maxy - miny)),
);

function iou2(sx, sy, tx, ty, step = 2) {
  let inter = 0;
  let cOnly = 0;
  let mOnly = 0;
  for (let y = miny; y <= maxy; y += step) {
    for (let x = minx; x <= maxx; x += step) {
      if (!mainland[y * W + x]) continue;
      const ox = Math.round(sx * (x - cx) + tx);
      const oy = Math.round(sy * (y - cy) + ty);
      if (ox >= 0 && oy >= 0 && ox < outW && oy < outH && mask[oy * outW + ox]) {
        inter++;
      } else {
        cOnly++;
      }
    }
  }
  for (let y = mminy; y <= mmaxy; y += step + 1) {
    for (let x = mminx; x <= mmaxx; x += step + 1) {
      if (!mask[y * outW + x]) continue;
      const ix = Math.round((x - tx) / sx + cx);
      const iy = Math.round((y - ty) / sy + cy);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H || !mainland[iy * W + ix]) {
        mOnly++;
      }
    }
  }
  return inter / (inter + cOnly + mOnly || 1);
}

let fit = { iou: 0, sc: sc0, tx: mtx, ty: mty };
for (let sc = sc0 * 0.85; sc <= sc0 * 1.25; sc += 0.01) {
  for (let dx = -80; dx <= 80; dx += 2) {
    for (let dy = -80; dy <= 80; dy += 2) {
      const v = iou2(sc, sc, mtx + dx, mty + dy, 3);
      if (v > fit.iou) fit = { iou: v, sc, tx: mtx + dx, ty: mty + dy };
    }
  }
}
let best = {
  iou: fit.iou,
  sx: fit.sc,
  sy: fit.sc,
  tx: fit.tx,
  ty: fit.ty,
};
for (let sx = fit.sc * 0.9; sx <= fit.sc * 1.1; sx += 0.01) {
  for (let sy = fit.sc * 0.9; sy <= fit.sc * 1.1; sy += 0.01) {
    for (let dx = -20; dx <= 20; dx += 2) {
      for (let dy = -20; dy <= 20; dy += 2) {
        const v = iou2(sx, sy, fit.tx + dx, fit.ty + dy, 3);
        if (v > best.iou)
          best = { iou: v, sx, sy, tx: fit.tx + dx, ty: fit.ty + dy };
      }
    }
  }
}
for (let sx = best.sx - 0.03; sx <= best.sx + 0.03; sx += 0.005) {
  for (let sy = best.sy - 0.03; sy <= best.sy + 0.03; sy += 0.005) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const v = iou2(sx, sy, best.tx + dx, best.ty + dy, 2);
        if (v > best.iou)
          best = { iou: v, sx, sy, tx: best.tx + dx, ty: best.ty + dy };
      }
    }
  }
}

const params = {
  mode: "stretch",
  scX: best.sx,
  scY: best.sy,
  tx: best.tx,
  ty: best.ty,
  chartCx: cx,
  chartCy: cy,
  chartW: W,
  chartH: H,
  legendH,
  outW,
  outH,
  iou: best.iou,
};
fs.writeFileSync(
  path.join(__dirname, "../src/lib/weather/synoptic-fit.json"),
  JSON.stringify(params, null, 2),
);
console.log("wrote stretch fit", params);
