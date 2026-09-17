/**
 * Fit a uniform H/V stretch of BoM IDY00030 into the national GIBS frame.
 * Mainland-only mask + distance-transform coast cost (Tasmania excluded).
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

function dilate(a, w, h, r) {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!a[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) o[ny * w + nx] = 1;
        }
      }
    }
  }
  return o;
}
function erode(a, w, h, r) {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !a[ny * w + nx]) {
            ok = 0;
            break;
          }
        }
      }
      o[y * w + x] = ok;
    }
  }
  return o;
}

const closed = erode(dilate(land, W, H, 2), W, H, 2);
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
      const [cx0, cy0] = q.pop();
      cells.push([cx0, cy0]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx0 + dx;
          const ny = cy0 + dy;
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

const chartEdge = [];
for (let y = miny; y <= maxy; y++) {
  for (let x = minx; x <= maxx; x++) {
    if (!mainland[y * W + x]) continue;
    if (
      x <= 0 ||
      y <= 0 ||
      x >= W - 1 ||
      y >= H - 1 ||
      !mainland[y * W + x - 1] ||
      !mainland[y * W + x + 1] ||
      !mainland[(y - 1) * W + x] ||
      !mainland[(y + 1) * W + x]
    ) {
      chartEdge.push(x, y);
    }
  }
}

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
  let bestIdx = 0;
  let bestAbs = -1;
  for (let i = 0; i < polys.length; i++) {
    const ring = polys[i][0];
    let a = 0;
    for (let j = 0; j < ring.length; j++) {
      const [lon, lat] = ring[j];
      const [lon2, lat2] = ring[(j + 1) % ring.length];
      a += lon * lat2 - lon2 * lat;
    }
    if (Math.abs(a) > bestAbs) {
      bestAbs = Math.abs(a);
      bestIdx = i;
    }
  }
  fillPoly(polys[bestIdx][0].map(([lon, lat]) => toPix(lon, lat)));
}

let mmx = 0;
let mmy = 0;
let mn = 0;
let mminx = outW;
let mminy = outH;
let mmaxx = 0;
let mmaxy = 0;
const maskEdgePts = [];
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
for (let y = mminy; y <= mmaxy; y++) {
  for (let x = mminx; x <= mmaxx; x++) {
    if (!mask[y * outW + x]) continue;
    if (
      x === 0 ||
      y === 0 ||
      x === outW - 1 ||
      y === outH - 1 ||
      !mask[y * outW + x - 1] ||
      !mask[y * outW + x + 1] ||
      !mask[(y - 1) * outW + x] ||
      !mask[(y + 1) * outW + x]
    ) {
      maskEdgePts.push(x, y);
    }
  }
}
const mtx = mmx / mn;
const mty = mmy / mn;
const sc0 = Math.sqrt(
  ((mmaxx - mminx) * (mmaxy - mminy)) / ((maxx - minx) * (maxy - miny)),
);

/** Squared Euclidean distance transform to nearest set pixel (Meijster). */
function edtSquared(seed, w, h) {
  const INF = 1e12;
  const f = new Float64Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = seed[i] ? 0 : INF;
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) d[x] = f[y * w + x];
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < w; q++) {
      let s;
      for (;;) {
        const r = v[k];
        s =
          (d[q] - d[r] + q * q - r * r) /
          (2 * q - 2 * r);
        if (s > z[k]) break;
        if (--k < 0) {
          k = 0;
          break;
        }
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < w; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k];
      f[y * w + q] = (q - r) * (q - r) + d[r];
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) d[y] = f[y * w + x];
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < h; q++) {
      let s;
      for (;;) {
        const r = v[k];
        s =
          (d[q] - d[r] + q * q - r * r) /
          (2 * q - 2 * r);
        if (s > z[k]) break;
        if (--k < 0) {
          k = 0;
          break;
        }
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < h; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k];
      f[q * w + x] = (q - r) * (q - r) + d[r];
    }
  }
  return f;
}

const maskEdgeSeed = new Uint8Array(outW * outH);
for (let i = 0; i < maskEdgePts.length; i += 2) {
  maskEdgeSeed[maskEdgePts[i + 1] * outW + maskEdgePts[i]] = 1;
}
const maskDist2 = edtSquared(maskEdgeSeed, outW, outH);

const chartEdgeSeed = new Uint8Array(W * H);
for (let i = 0; i < chartEdge.length; i += 2) {
  chartEdgeSeed[chartEdge[i + 1] * W + chartEdge[i]] = 1;
}
const chartDist2 = edtSquared(chartEdgeSeed, W, H);

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

function meanEdge(sx, sy, tx, ty) {
  let sum = 0;
  let n = 0;
  const stepC = 3;
  for (let i = 0; i < chartEdge.length; i += stepC * 2) {
    const x = chartEdge[i];
    const y = chartEdge[i + 1];
    const ox = Math.round(sx * (x - cx) + tx);
    const oy = Math.round(sy * (y - cy) + ty);
    if (ox < 0 || oy < 0 || ox >= outW || oy >= outH) {
      sum += 80;
    } else {
      sum += Math.sqrt(maskDist2[oy * outW + ox]);
    }
    n++;
  }
  const stepM = 3;
  for (let i = 0; i < maskEdgePts.length; i += stepM * 2) {
    const mx = maskEdgePts[i];
    const my = maskEdgePts[i + 1];
    const ix = Math.round((mx - tx) / sx + cx);
    const iy = Math.round((my - ty) / sy + cy);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) {
      sum += 80;
    } else {
      sum += Math.sqrt(chartDist2[iy * W + ix]);
    }
    n++;
  }
  return sum / (n || 1);
}

function score(sx, sy, tx, ty, step = 3) {
  const iou = iou2(sx, sy, tx, ty, step);
  const edge = meanEdge(sx, sy, tx, ty);
  return { cost: edge + (1 - iou) * 6, iou, edge };
}

console.log("sc0", sc0, "centroids", { cx, cy, mtx, mty }, "edges", {
  chart: chartEdge.length / 2,
  mask: maskEdgePts.length / 2,
});

let fit = { cost: 1e9, iou: 0, edge: 1e9, sc: sc0, tx: mtx, ty: mty };
for (let sc = sc0 * 0.88; sc <= sc0 * 1.18; sc += 0.008) {
  for (let dx = -70; dx <= 70; dx += 2) {
    for (let dy = -70; dy <= 70; dy += 2) {
      const s = score(sc, sc, mtx + dx, mty + dy, 4);
      if (s.cost < fit.cost)
        fit = {
          cost: s.cost,
          iou: s.iou,
          edge: s.edge,
          sc,
          tx: mtx + dx,
          ty: mty + dy,
        };
    }
  }
}
console.log("iso coarse", fit);

let best = {
  cost: fit.cost,
  iou: fit.iou,
  edge: fit.edge,
  sx: fit.sc,
  sy: fit.sc,
  tx: fit.tx,
  ty: fit.ty,
};
for (let sx = fit.sc * 0.92; sx <= fit.sc * 1.08; sx += 0.008) {
  for (let sy = fit.sc * 0.92; sy <= fit.sc * 1.08; sy += 0.008) {
    for (let dx = -16; dx <= 16; dx += 2) {
      for (let dy = -16; dy <= 16; dy += 2) {
        const s = score(sx, sy, fit.tx + dx, fit.ty + dy, 3);
        if (s.cost < best.cost)
          best = {
            cost: s.cost,
            iou: s.iou,
            edge: s.edge,
            sx,
            sy,
            tx: fit.tx + dx,
            ty: fit.ty + dy,
          };
      }
    }
  }
}
console.log("aniso mid", best);

for (let sx = best.sx - 0.02; sx <= best.sx + 0.02; sx += 0.0025) {
  for (let sy = best.sy - 0.02; sy <= best.sy + 0.02; sy += 0.0025) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const s = score(sx, sy, best.tx + dx, best.ty + dy, 2);
        if (s.cost < best.cost)
          best = {
            cost: s.cost,
            iou: s.iou,
            edge: s.edge,
            sx,
            sy,
            tx: best.tx + dx,
            ty: best.ty + dy,
          };
      }
    }
  }
}
console.log("fine", best);

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
  meanEdge: best.edge,
  iou: best.iou,
  cost: best.cost,
};
fs.writeFileSync(
  path.join(__dirname, "../src/lib/weather/synoptic-fit.json"),
  JSON.stringify(params, null, 2),
);

const out = new PNG({ width: outW, height: outH });
for (let oy = 0; oy < outH; oy++) {
  for (let ox = 0; ox < outW; ox++) {
    const x = (ox + 0.5 - best.tx) / best.sx + cx;
    const y = (oy + 0.5 - best.ty) / best.sy + cy;
    const o = (oy * outW + ox) * 4;
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1 || y >= H - legendH) {
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
for (let i = 0; i < maskEdgePts.length; i += 2) {
  const x = maskEdgePts[i];
  const y = maskEdgePts[i + 1];
  const o = (y * outW + x) * 4;
  out.data[o] = 255;
  out.data[o + 1] = 0;
  out.data[o + 2] = 0;
  out.data[o + 3] = 255;
}
const art = "/opt/cursor/artifacts/synoptic-stretch-v9.png";
fs.writeFileSync(art, PNG.sync.write(out));
console.log("wrote stretch fit", params);
console.log("preview", art);
