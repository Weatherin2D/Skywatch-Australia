import { PNG } from "pngjs";
import {
  GIBS_DISPLAY_WIDTH,
  GIBS_REGION_DISPLAY_WIDTH,
  RE_MAX_WIDTH,
  RE_PANEL_MAX_EDGE,
  RE_PANEL_MAX_PIXELS,
  RE_STITCH_LONG_EDGE,
  boundsMercatorAspect,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
  lonLatToWebMercator,
  realEarthImageUrl,
  realEarthRasterSize,
  shouldStitchRealEarth,
  toIsoZ,
  webMercatorToLonLat,
  type LonLatBounds,
  type SatelliteProductId,
} from "@/lib/weather/maps";
import { getCachedFrame, setCachedFrame } from "@/lib/weather/frame-cache";

const MIN_FRAME_BYTES = 8_000;
const HIMAWARI_STEP_SEC = 10 * 60;
const FETCH_ATTEMPTS = 3;
const PANEL_FETCH_ATTEMPTS = 2;
const PANEL_CONCURRENCY = 4;

function gibsUrlFor(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): string | null {
  const meta = getSatelliteProduct(product);
  if (!meta.gibsLayer) return null;
  const isRegional = region !== "national";
  const width = isRegional ? GIBS_REGION_DISPLAY_WIDTH : GIBS_DISPLAY_WIDTH;
  return gibsHimawariWmsUrl(toIsoZ(timeUnix * 1000), product, {
    width,
    bounds,
  });
}

/** Descending RealEarth widths to try until the export is clean. */
function realEarthWidthLadder(bounds: LonLatBounds): number[] {
  const preferred = realEarthRasterSize(bounds).width;
  const ladder = [
    preferred,
    Math.min(preferred, 960),
    880,
    800,
    720,
    640,
    512,
    400,
  ];
  return [...new Set(ladder.map((w) => Math.max(320, Math.round(w))))].sort(
    (a, b) => b - a,
  );
}

function realEarthUrlAtSize(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  width: number,
  height?: number,
): string | null {
  const meta = getSatelliteProduct(product);
  if (!meta.realearthProduct) return null;
  const aspect = boundsMercatorAspect(bounds);
  const h = height ?? Math.max(1, Math.round(width / aspect));
  return realEarthImageUrl(meta.realearthProduct, timeUnix, {
    width: Math.min(width, RE_MAX_WIDTH),
    height: h,
    bounds,
  });
}

/**
 * Rebuild the bottom-left corner badge (SSEC or NASA meatball) from
 * neighbouring imagery so georefencing stays intact.
 */
export function stripCornerBadge(pngBuffer: Buffer): Buffer {
  let png: PNG;
  try {
    png = PNG.sync.read(pngBuffer);
  } catch {
    return pngBuffer;
  }
  stripCornerBadgeInPlace(png);
  try {
    return PNG.sync.write(png);
  } catch {
    return pngBuffer;
  }
}

/** In-place SSEC/NASA corner repair; scales with raster size. */
function stripCornerBadgeInPlace(png: PNG): void {
  const { width, height, data } = png;
  if (width < 48 || height < 48) return;

  // Keep the patch proportional — a fixed 72px floor wrecked small panels.
  const logoW = Math.max(28, Math.round(width * (width < 500 ? 0.16 : 0.12)));
  const logoH = Math.max(
    28,
    Math.round(Math.min(height * (height < 500 ? 0.18 : 0.14), width * 0.16)),
  );
  const y0 = height - logoH;
  const srcX0 = Math.min(
    width - 1,
    logoW + Math.max(6, Math.round(width * 0.03)),
  );

  for (let y = y0; y < height; y++) {
    const ty = (y - y0) / Math.max(1, logoH - 1);
    for (let x = 0; x < logoW; x++) {
      const tx = x / Math.max(1, logoW - 1);
      const radial = Math.hypot(tx * 1.05, (1 - ty) * 0.95);
      const baseline = ty > 0.55 && tx < 0.92 ? 1 : 0;
      const corner = (1 - tx) * (0.25 + 0.75 * ty);
      const w =
        radial < 0.98
          ? 1
          : baseline
            ? 0.95
            : corner > 0.2
              ? Math.min(1, corner / 0.28)
              : 0;
      if (w <= 0.02) continue;

      const srcY = Math.max(0, y0 - 6 - Math.floor((1 - ty) * 18));
      const srcX = Math.min(width - 1, srcX0 + Math.floor(x * 0.35));
      const di = (y * width + x) * 4;
      const siUp = (srcY * width + Math.min(width - 1, x)) * 4;
      const siRight = (y * width + srcX) * 4;
      for (let c = 0; c < 3; c++) {
        const src = Math.round(data[siUp + c]! * 0.65 + data[siRight + c]! * 0.35);
        data[di + c] = Math.round(data[di + c]! * (1 - w) + src * w);
      }
    }
  }
}

/** @deprecated Use stripCornerBadge. */
export const stripRealEarthWatermark = stripCornerBadge;

/**
 * Detect RealEarth's burned-in "Size limit exceeded" / attribution banner.
 * SSEC responses are intermittent — same URL can flip between clean and marked.
 */
export function hasRealEarthSizeLimitOverlay(pngBuffer: Buffer): boolean {
  let png: PNG;
  try {
    png = PNG.sync.read(pngBuffer);
  } catch {
    return false;
  }
  const { width, height, data } = png;
  if (width < 64 || height < 64) return false;

  let maxRow = 0;
  let brightSum = 0;
  let maxWhite = 0;
  let whiteRows = 0;
  const y0 = Math.floor(height * 0.45);
  const stepX = Math.max(1, Math.floor(width / 250));
  for (let y = y0; y < height; y++) {
    let bright = 0;
    let white = 0;
    let n = 0;
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const gray = (r + g + b) / 3;
      if (gray > 175) bright += 1;
      if (r > 200 && g > 200 && b > 200) white += 1;
      n += 1;
    }
    const brightRatio = bright / n;
    const whiteRatio = white / n;
    maxRow = Math.max(maxRow, brightRatio);
    brightSum += brightRatio;
    maxWhite = Math.max(maxWhite, whiteRatio);
    if (whiteRatio > 0.05) whiteRows += 1;
  }

  return (
    maxRow >= 0.08 ||
    brightSum >= 2.5 ||
    maxWhite >= 0.04 ||
    whiteRows >= 8
  );
}

/**
 * Reject empty placeholders that still return HTTP 200 for unpublished times.
 */
function frameHasRealContent(body: Buffer): boolean {
  if (body.length < MIN_FRAME_BYTES) return false;

  if (body.length >= 80_000) {
    let bright = 0;
    for (let i = 64; i < Math.min(body.length, 6000); i += 13) {
      if (body[i]! > 18) bright += 1;
    }
    return bright >= 8;
  }

  try {
    const png = PNG.sync.read(body);
    const { width, height, data } = png;
    if (width < 32 || height < 32) return false;
    let sum = 0;
    let sum2 = 0;
    let lit = 0;
    let n = 0;
    const step = Math.max(1, Math.floor((width * height) / 2500));
    for (let i = 0; i < width * height; i += step) {
      const o = i * 4;
      const g = (data[o]! + data[o + 1]! + data[o + 2]!) / 3;
      sum += g;
      sum2 += g * g;
      if (g > 22) lit += 1;
      n += 1;
    }
    if (n < 50) return false;
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    const litRatio = lit / n;
    return litRatio >= 0.04 && variance >= 180;
  } catch {
    return body.length >= 40_000;
  }
}

async function fetchUpstreamOnce(
  upstream: string,
  options?: { rejectSizeLimitOverlay?: boolean; timeoutMs?: number },
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(upstream, {
      headers: {
        "User-Agent": "SkyWatchAustralia/1.0",
        Accept: "image/png,image/*;q=0.9,*/*;q=0.1",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(options?.timeoutMs ?? 45_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.includes("image")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (!frameHasRealContent(body)) return null;
    if (options?.rejectSizeLimitOverlay && hasRealEarthSizeLimitOverlay(body)) {
      return null;
    }
    return { body, contentType };
  } catch {
    return null;
  }
}

type PanelPlan = {
  cols: number;
  rows: number;
  outWidth: number;
  outHeight: number;
};

function planPanelGrid(bounds: LonLatBounds): PanelPlan {
  const aspect = boundsMercatorAspect(bounds);
  const longEdge = RE_STITCH_LONG_EDGE;
  const outWidth =
    aspect >= 1 ? longEdge : Math.max(1, Math.round(longEdge * aspect));
  const outHeight =
    aspect >= 1 ? Math.max(1, Math.round(longEdge / aspect)) : longEdge;

  for (let rows = 1; rows <= 5; rows++) {
    for (let cols = 1; cols <= 4; cols++) {
      const pw = Math.ceil(outWidth / cols);
      const ph = Math.ceil(outHeight / rows);
      if (
        pw <= RE_PANEL_MAX_EDGE &&
        ph <= RE_PANEL_MAX_EDGE &&
        pw * ph <= RE_PANEL_MAX_PIXELS
      ) {
        return { cols, rows, outWidth, outHeight };
      }
    }
  }
  // Fallback densest grid.
  return {
    cols: 3,
    rows: 4,
    outWidth,
    outHeight,
  };
}

function panelBounds(
  bounds: LonLatBounds,
  cols: number,
  rows: number,
  col: number,
  row: number,
): LonLatBounds {
  const [[south, west], [north, east]] = bounds;
  const [minx, miny] = lonLatToWebMercator(west, south);
  const [maxx, maxy] = lonLatToWebMercator(east, north);
  // row 0 = northernmost (image top)
  const x0 = minx + ((maxx - minx) * col) / cols;
  const x1 = minx + ((maxx - minx) * (col + 1)) / cols;
  const y1 = maxy - ((maxy - miny) * row) / rows;
  const y0 = maxy - ((maxy - miny) * (row + 1)) / rows;
  const [lon0, lat0] = webMercatorToLonLat(x0, y0);
  const [lon1, lat1] = webMercatorToLonLat(x1, y1);
  return [
    [lat0, lon0],
    [lat1, lon1],
  ];
}

function clampPanelSize(width: number, aspect: number): {
  width: number;
  height: number;
} {
  let w = Math.max(32, Math.round(width));
  let h = Math.max(1, Math.round(w / aspect));
  while (
    (w > RE_PANEL_MAX_EDGE || h > RE_PANEL_MAX_EDGE || w * h > RE_PANEL_MAX_PIXELS) &&
    w > 160
  ) {
    w = Math.max(160, Math.floor(w * 0.88));
    h = Math.max(1, Math.round(w / aspect));
  }
  return { width: w, height: h };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await worker(items[i]!, i);
    }
  };
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

/**
 * Fetch one RealEarth panel with retries. Size-limit banners are intermittent,
 * so retry the same size before stepping down. Fall back to a GIBS tile for
 * that panel so one dirty SSEC response does not abandon the whole mosaic.
 */
async function fetchRealEarthPanel(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  preferWidth: number,
): Promise<PNG | null> {
  const aspect = boundsMercatorAspect(bounds);
  let { width, height } = clampPanelSize(preferWidth, aspect);

  for (let shrink = 0; shrink < 2; shrink++) {
    const url = realEarthUrlAtSize(product, timeUnix, bounds, width, height);
    if (!url) break;
    for (let attempt = 0; attempt < PANEL_FETCH_ATTEMPTS; attempt++) {
      const got = await fetchUpstreamOnce(url, {
        rejectSizeLimitOverlay: true,
        timeoutMs: 12_000,
      });
      if (got) {
        try {
          // Strip once on the final mosaic — per-panel badge repair leaves
          // visible blotches on small tiles.
          const png = PNG.sync.read(got.body);
          stripCornerBadgeInPlace(png);
          return png;
        } catch {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
    }
    width = Math.max(140, Math.floor(width * 0.7));
    height = Math.max(1, Math.round(width / aspect));
  }

  // Panel-level GIBS fallback keeps the mosaic complete and watermark-free.
  const gibsUrl = gibsHimawariWmsUrl(toIsoZ(timeUnix * 1000), product, {
    width: Math.min(480, Math.max(160, preferWidth)),
    bounds,
  });
  const got = await fetchUpstreamOnce(gibsUrl, { timeoutMs: 12_000 });
  if (!got) return null;
  try {
    const png = PNG.sync.read(got.body);
    stripCornerBadgeInPlace(png);
    return png;
  } catch {
    return null;
  }
}

function blitPng(
  dest: PNG,
  src: PNG,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
): void {
  // Nearest-neighbor scale src → dest rect (panels are already near-native size).
  for (let y = 0; y < destH; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / destH));
    for (let x = 0; x < destW; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / destW));
      const di = ((destY + y) * dest.width + (destX + x)) * 4;
      const si = (sy * src.width + sx) * 4;
      dest.data[di] = src.data[si]!;
      dest.data[di + 1] = src.data[si + 1]!;
      dest.data[di + 2] = src.data[si + 2]!;
      dest.data[di + 3] = 255;
    }
  }
}

/**
 * Large state crops: request a grid of small RealEarth panels and stitch them
 * into one watermark-free mosaic.
 */
async function fetchRealEarthStitched(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
): Promise<{ body: Buffer; contentType: string } | null> {
  const plan = planPanelGrid(bounds);
  const cells: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < plan.rows; row++) {
    for (let col = 0; col < plan.cols; col++) {
      cells.push({ col, row });
    }
  }

  const panels = await mapPool(cells, PANEL_CONCURRENCY, async ({ col, row }) => {
    const b = panelBounds(bounds, plan.cols, plan.rows, col, row);
    const preferW = Math.ceil(plan.outWidth / plan.cols);
    const png = await fetchRealEarthPanel(product, timeUnix, b, preferW);
    return { col, row, png };
  });

  const ok = panels.filter((p) => p.png != null);
  if (ok.length === 0) {
    return null;
  }
  // Fill holes from the nearest successful panel so one missing tile does not
  // abandon a large-state mosaic.
  const filled = panels.map((p) => {
    if (p.png) return p;
    let best: (typeof panels)[number] | null = null;
    let bestDist = Infinity;
    for (const q of ok) {
      const dist = Math.abs(q.col - p.col) + Math.abs(q.row - p.row);
      if (dist < bestDist) {
        bestDist = dist;
        best = q;
      }
    }
    return { col: p.col, row: p.row, png: best?.png ?? null };
  });
  if (filled.some((p) => p.png == null)) {
    return null;
  }

  const mosaic = new PNG({
    width: plan.outWidth,
    height: plan.outHeight,
    fill: true,
  });

  for (const { col, row, png } of filled) {
    if (!png) continue;
    const x0 = Math.round((plan.outWidth * col) / plan.cols);
    const x1 = Math.round((plan.outWidth * (col + 1)) / plan.cols);
    const y0 = Math.round((plan.outHeight * row) / plan.rows);
    const y1 = Math.round((plan.outHeight * (row + 1)) / plan.rows);
    blitPng(mosaic, png, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }

  let body: Buffer;
  try {
    body = PNG.sync.write(mosaic);
  } catch {
    return null;
  }
  body = stripCornerBadge(body);
  // Panels were already screened; a mosaic-level false positive (bright cloud)
  // must not discard a good stitch.
  return { body, contentType: "image/png" };
}

/**
 * Fetch RealEarth at a size that avoids the "Size limit exceeded" overlay,
 * then strip the SSEC corner badge. Large regions use multi-panel stitch.
 */
async function fetchRealEarthClean(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  // Large state zooms: panel-stitch only. A single big RealEarth export is what
  // burns the "Size limit exceeded" banner — never fall back to that path.
  if (region !== "national" && shouldStitchRealEarth(bounds)) {
    return fetchRealEarthStitched(product, timeUnix, bounds);
  }

  for (const width of realEarthWidthLadder(bounds)) {
    const url = realEarthUrlAtSize(product, timeUnix, bounds, width);
    if (!url) return null;
    for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
      const got = await fetchUpstreamOnce(url, {
        rejectSizeLimitOverlay: true,
      });
      if (!got) {
        if (attempt < FETCH_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
        continue;
      }
      return {
        body: stripCornerBadge(got.body),
        contentType: got.contentType,
      };
    }
  }
  return null;
}

async function fetchGibsClean(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  let gibsUrl = gibsUrlFor(product, timeUnix, bounds, region);
  const meta = getSatelliteProduct(product);
  if (!gibsUrl && meta.gibsLayer) {
    gibsUrl = gibsHimawariWmsUrl(toIsoZ(timeUnix * 1000), product, {
      width:
        region !== "national" ? GIBS_REGION_DISPLAY_WIDTH : GIBS_DISPLAY_WIDTH,
      bounds,
    });
  }
  if (!gibsUrl) return null;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const got = await fetchUpstreamOnce(gibsUrl);
    if (got) {
      return {
        body: stripCornerBadge(got.body),
        contentType: got.contentType,
      };
    }
    if (attempt < FETCH_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * Prefer RealEarth (fresher ~15–30 min tip). Large state zooms are stitched
 * from multiple panel requests. Fall back to GIBS when RealEarth misses.
 */
async function fetchUpstreamWithRetry(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds,
  region: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const meta = getSatelliteProduct(product);

  if (meta.realearthProduct) {
    const re = await fetchRealEarthClean(product, timeUnix, bounds, region);
    if (re) return re;
  }

  return fetchGibsClean(product, timeUnix, bounds, region);
}

/** Fetch a Himawari frame (or memory cache) and store it. */
export async function fetchAndCacheFrame(
  product: SatelliteProductId,
  timeUnix: number,
  bounds: LonLatBounds = [
    [-48, 105],
    [-5, 165],
  ],
  region = "national",
): Promise<{ body: Buffer; contentType: string } | null> {
  const cached = getCachedFrame(product, timeUnix, region);
  if (cached) return { body: cached.body, contentType: cached.contentType };

  const got = await fetchUpstreamWithRetry(product, timeUnix, bounds, region);
  if (!got) return null;
  setCachedFrame(product, timeUnix, got.body, got.contentType, region);
  return got;
}

/**
 * Exact time first, then at most ±1 / ±2 neighbouring slots.
 * Distant lookbacks were caching the wrong image under the requested stamp,
 * which made the animation appear to skip frames.
 */
export async function fetchAndCacheFrameResilient(
  product: SatelliteProductId,
  timeUnix: number,
  bounds?: LonLatBounds,
  region = "national",
): Promise<{ body: Buffer; contentType: string; resolvedTime: number } | null> {
  const frameBounds: LonLatBounds = bounds ?? [
    [-48, 105],
    [-5, 165],
  ];
  const cached = getCachedFrame(product, timeUnix, region);
  if (cached) {
    return {
      body: cached.body,
      contentType: cached.contentType,
      resolvedTime: timeUnix,
    };
  }

  const offsets = [
    0,
    -HIMAWARI_STEP_SEC,
    HIMAWARI_STEP_SEC,
    -2 * HIMAWARI_STEP_SEC,
    2 * HIMAWARI_STEP_SEC,
  ];
  for (const off of offsets) {
    const t = timeUnix + off;
    if (t <= 0) continue;
    const got =
      off === 0
        ? await fetchUpstreamWithRetry(product, t, frameBounds, region)
        : await fetchAndCacheFrame(product, t, frameBounds, region);
    if (!got) continue;
    if (off === 0 || Math.abs(off) === HIMAWARI_STEP_SEC) {
      setCachedFrame(product, timeUnix, got.body, got.contentType, region);
    }
    if (off !== 0) {
      setCachedFrame(product, t, got.body, got.contentType, region);
    }
    return { ...got, resolvedTime: t };
  }
  return null;
}

/** Warm the in-memory cache for a product without blocking the caller. */
export function warmFramesInBackground(
  product: SatelliteProductId,
  times: number[],
  concurrency = 2,
): void {
  let cursor = 0;
  let active = 0;

  const pump = () => {
    while (active < concurrency && cursor < times.length) {
      const time = times[cursor]!;
      cursor += 1;
      active += 1;
      void fetchAndCacheFrameResilient(product, time).finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  pump();
}
