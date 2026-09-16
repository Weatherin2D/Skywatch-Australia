/**
 * Empirically register BoM IDY00030 colour MSLP against the national
 * Australia outline in the GIBS Mercator frame. Writes:
 *   - src/lib/weather/synoptic-fit.json  (baked into synoptic-warp.ts)
 *   - /opt/cursor/artifacts/synoptic-mainland-iou.png  (red = GeoJSON coast)
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
for (let y = 0; y < H - 70; y++) {
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

function dilate(srcA, r) {
  const out = new Uint8Array(srcA.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!srcA[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1;
        }
      }
    }
  }
  return out;
}

function erode(srcA, r) {
  const out = new Uint8Array(srcA.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !srcA[ny * W + nx]) {
            ok = 0;
            break;
          }
        }
      }
      out[y * W + x] = ok;
    }
  }
  return out;
}

// Morphological close bridges state-border gaps that fragment the beige fill.
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
let sx = 0;
let sy = 0;
let minx = W;
let miny = H;
let maxx = 0;
let maxy = 0;
for (const [x, y] of largest) {
  mainland[y * W + x] = 1;
  sx += x;
  sy += y;
  minx = Math.min(minx, x);
  maxx = Math.max(maxx, x);
  miny = Math.min(miny, y);
  maxy = Math.max(maxy, y);
}
const cx = sx / largest.length;
const cy = sy / largest.length;
const cbw = maxx - minx;
const cbh = maxy - miny;
console.log("mainland", largest.length, { cx, cy, minx, miny, maxx, maxy });

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
const mbw = mmaxx - mminx;
const mbh = mmaxy - mminy;

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

const sc0 = Math.sqrt((mbw * mbh) / (cbw * cbh));
let fit = { iou: 0, sc: sc0, tx: mtx, ty: mty };
for (let sc = sc0 * 0.85; sc <= sc0 * 1.25; sc += 0.01) {
  for (let dx = -80; dx <= 80; dx += 2) {
    for (let dy = -80; dy <= 80; dy += 2) {
      const v = iou2(sc, sc, mtx + dx, mty + dy, 3);
      if (v > fit.iou) fit = { iou: v, sc, tx: mtx + dx, ty: mty + dy };
    }
  }
}
console.log("coarse", fit);
for (let sc = fit.sc - 0.05; sc <= fit.sc + 0.05; sc += 0.005) {
  for (let dx = -8; dx <= 8; dx++) {
    for (let dy = -8; dy <= 8; dy++) {
      const v = iou2(sc, sc, fit.tx + dx, fit.ty + dy, 2);
      if (v > fit.iou) fit = { iou: v, sc, tx: fit.tx + dx, ty: fit.ty + dy };
    }
  }
}
console.log("fine", fit);

let fit2 = {
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
        if (v > fit2.iou)
          fit2 = { iou: v, sx, sy, tx: fit.tx + dx, ty: fit.ty + dy };
      }
    }
  }
}
for (let sx = fit2.sx - 0.03; sx <= fit2.sx + 0.03; sx += 0.005) {
  for (let sy = fit2.sy - 0.03; sy <= fit2.sy + 0.03; sy += 0.005) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const v = iou2(sx, sy, fit2.tx + dx, fit2.ty + dy, 2);
        if (v > fit2.iou)
          fit2 = { iou: v, sx, sy, tx: fit2.tx + dx, ty: fit2.ty + dy };
      }
    }
  }
}
console.log("aniso", fit2);

const use = {
  scX: fit2.sx,
  scY: fit2.sy,
  tx: fit2.tx,
  ty: fit2.ty,
  iou: fit2.iou,
};

const out = new PNG({ width: outW, height: outH });
for (let oy = 0; oy < outH; oy++) {
  for (let ox = 0; ox < outW; ox++) {
    const x = (ox - use.tx) / use.scX + cx;
    const y = (oy - use.ty) / use.scY + cy;
    const o = (oy * outW + ox) * 4;
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) {
      out.data[o + 3] = 0;
      continue;
    }
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
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
for (let y = 1; y < outH - 1; y++) {
  for (let x = 1; x < outW - 1; x++) {
    if (!mask[y * outW + x]) continue;
    if (
      !mask[y * outW + x - 1] ||
      !mask[y * outW + x + 1] ||
      !mask[(y - 1) * outW + x] ||
      !mask[(y + 1) * outW + x]
    ) {
      const i = (y * outW + x) * 4;
      out.data[i] = 255;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
    }
  }
}

const artDir = "/opt/cursor/artifacts";
fs.mkdirSync(artDir, { recursive: true });
fs.writeFileSync(
  path.join(artDir, "synoptic-mainland-iou.png"),
  PNG.sync.write(out),
);

const params = {
  mode: "affine_scale",
  scX: use.scX,
  scY: use.scY,
  tx: use.tx,
  ty: use.ty,
  chartCx: cx,
  chartCy: cy,
  chartW: W,
  chartH: H,
  outW,
  outH,
  iou: use.iou,
  bounds: { south, west, north, east },
};
fs.writeFileSync(
  path.join(__dirname, "../src/lib/weather/synoptic-fit.json"),
  JSON.stringify(params, null, 2),
);
console.log("wrote", params);
