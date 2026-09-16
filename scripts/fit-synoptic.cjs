/**
 * Fit BoM IDY00030 colour MSLP to the national GeoJSON outline.
 *
 * Builds a thin-plate spline (mercator overlay px → chart px) from coast-tip
 * control points and writes src/lib/weather/synoptic-fit.json for synoptic-warp.ts.
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

const south = -48;
const west = 105;
const north = -5;
const east = 165;

function lonLatToWebMercator(lon, lat) {
  const x = (lon * 20037508.34) / 180;
  let y =
    Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}

const [minX, minY] = lonLatToWebMercator(west, south);
const [maxX, maxY] = lonLatToWebMercator(east, north);
const outW = 1024;
const outH = Math.round(outW / ((maxX - minX) / (maxY - minY)));

function toPix(lon, lat) {
  const [x, y] = lonLatToWebMercator(lon, lat);
  return [
    ((x - minX) / (maxX - minX)) * outW,
    ((maxY - y) / (maxY - minY)) * outH,
  ];
}

// Mainland beige + morph-close + edge for snapping guesses
const land0 = new Uint8Array(W * H);
for (let y = 0; y < H - 70; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const r = src.data[i];
    const g = src.data[i + 1];
    const b = src.data[i + 2];
    if (r >= 238 && g >= 235 && b >= 210 && b <= 230 && Math.abs(r - g) < 8) {
      land0[y * W + x] = 1;
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
const closed = erode(dilate(land0, 2), 2);
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
for (const [x, y] of largest) mainland[y * W + x] = 1;
const edge = [];
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (!mainland[y * W + x]) continue;
    if (
      !mainland[y * W + x - 1] ||
      !mainland[y * W + x + 1] ||
      !mainland[(y - 1) * W + x] ||
      !mainland[(y + 1) * W + x]
    ) {
      edge.push([x, y]);
    }
  }
}
function snap(px, py, max = 40) {
  let best = [px, py];
  let bd = 1e9;
  for (const [x, y] of edge) {
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) {
      bd = d;
      best = [x, y];
    }
  }
  return Math.sqrt(bd) <= max ? best : [px, py];
}

const RAW = [
  [142.53, -10.69, 406, 17, "CapeYork"],
  [113.16, -26.15, 162, 124, "Steep"],
  [153.64, -28.64, 473, 159, "Byron"],
  [146.83, -43.64, 404, 265, "SECape"],
  [115.14, -34.37, 189, 209, "Leeuwin"],
  [114.17, -21.79, 169, 118, "NWCape"],
  [136.93, -11.74, 353, 27, "Arnhem"],
  [146.39, -39.12, 398, 240, "Wilson"],
  [150.0, -37.5, 450, 220, "Howe"],
  [122.0, -17.5, 210, 70, "Kimberley"],
  [130.0, -31.5, 300, 180, "BightW"],
  [135.0, -33.0, 330, 195, "BightC"],
  [138.0, -35.5, 360, 210, "SA"],
  [145.0, -15.0, 390, 50, "CarpentariaE"],
  [141.0, -17.0, 370, 55, "CarpentariaW"],
  [153.0, -26.0, 470, 140, "Fraser"],
  [121.0, -34.0, 210, 200, "Esperance"],
];

const ctrls = RAW.map(([lon, lat, px, py, name]) => {
  const [mx, my] = toPix(lon, lat);
  const [sx, sy] = snap(px, py);
  return { mx, my, px: sx, py: sy, lon, lat, name };
});

function U(r2) {
  if (r2 < 1e-12) return 0;
  const r = Math.sqrt(r2);
  return r2 * Math.log(r);
}

function solveTPS(targets) {
  const n = ctrls.length;
  const A = Array.from({ length: n + 3 }, () => Array(n + 3).fill(0));
  const b = Array(n + 3).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = ctrls[i].mx - ctrls[j].mx;
      const dy = ctrls[i].my - ctrls[j].my;
      A[i][j] = U(dx * dx + dy * dy);
    }
    A[i][n] = 1;
    A[i][n + 1] = ctrls[i].mx;
    A[i][n + 2] = ctrls[i].my;
    A[n][i] = 1;
    A[n + 1][i] = ctrls[i].mx;
    A[n + 2][i] = ctrls[i].my;
    b[i] = targets[i];
  }
  const M = n + 3;
  for (let col = 0; col < M; col++) {
    let piv = col;
    for (let r = col + 1; r < M; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const div = A[col][col];
    if (Math.abs(div) < 1e-12) continue;
    for (let c = col; c < M; c++) A[col][c] /= div;
    b[col] /= div;
    for (let r = 0; r < M; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c = col; c < M; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  return { w: b.slice(0, n), a0: b[n], a1: b[n + 1], a2: b[n + 2] };
}

const tpsX = solveTPS(ctrls.map((c) => c.px));
const tpsY = solveTPS(ctrls.map((c) => c.py));

const params = {
  mode: "tps",
  chartW: W,
  chartH: H,
  outW,
  outH,
  ctrls: ctrls.map((c) => ({
    mx: c.mx,
    my: c.my,
    px: c.px,
    py: c.py,
    lon: c.lon,
    lat: c.lat,
    name: c.name,
  })),
  tpsX,
  tpsY,
  notes:
    "Thin-plate spline mercator-px → chart-px from mainland coast tips on IDY00030.",
};

const outPath = path.join(__dirname, "../src/lib/weather/synoptic-fit.json");
fs.writeFileSync(outPath, JSON.stringify(params, null, 2));
console.log("wrote", outPath, "ctrls", ctrls.length);
