import {
  RADAR_PALETTE_ID,
  RADAR_RENDER_REV,
} from "@/lib/weather/radar-version";

export type WeatherFrame = {
  /** Unix time in seconds */
  time: number;
  /** RainViewer path fragment when available */
  path?: string;
  /**
   * Leaflet tile URL with {z}/{x}/{y} placeholders already ordered
   * (RainViewer: z/x/y, GIBS tiles: z/y/x). Prefer imageUrl for GIBS IR.
   */
  tileUrlTemplate?: string;
  /** Full-frame image overlay (GIBS WMS fallback) */
  imageUrl?: string;
  /** Leaflet LatLngBounds as [[south, west], [north, east]] */
  imageBounds?: [[number, number], [number, number]];
};

export type SatelliteProductId =
  | "infrared"
  | "visible"
  | "shortwave"
  | "airmass"
  | "dust"
  | "nightmicro"
  | "daymicro";

export type SatelliteProvider = "gibs" | "realearth";

export type SatelliteProductMeta = {
  id: SatelliteProductId;
  label: string;
  loopLabel: string;
  provider: SatelliteProvider;
  /** NASA GIBS Himawari layer id */
  gibsLayer?: string;
  /** SSEC RealEarth Himawari product id */
  realearthProduct?: string;
  /** Daytime-only products may return empty frames overnight */
  daytimeOnly?: boolean;
};

export const SATELLITE_PRODUCTS: readonly SatelliteProductMeta[] = [
  {
    id: "infrared",
    label: "Infrared",
    loopLabel: "Infrared loop",
    provider: "realearth",
    realearthProduct: "HIMAWARI-B13",
    gibsLayer: "Himawari_AHI_Band13_Clean_Infrared",
  },
  {
    id: "visible",
    label: "Visible",
    loopLabel: "Visible loop",
    provider: "realearth",
    realearthProduct: "HIMAWARI-B03",
    gibsLayer: "Himawari_AHI_Band3_Red_Visible_1km",
    daytimeOnly: true,
  },
  {
    id: "shortwave",
    label: "Shortwave IR",
    loopLabel: "Shortwave IR loop",
    provider: "realearth",
    realearthProduct: "HIMAWARI-B07",
  },
  {
    id: "airmass",
    label: "Air Mass",
    loopLabel: "Air Mass loop",
    provider: "realearth",
    realearthProduct: "HIMAWARI-airmass",
    gibsLayer: "Himawari_AHI_Air_Mass",
  },
  {
    id: "dust",
    label: "Dust RGB",
    loopLabel: "Dust RGB loop",
    provider: "realearth",
    realearthProduct: "HIMAWARI-dust",
  },
  {
    id: "nightmicro",
    label: "Night microphysics",
    loopLabel: "Night microphysics loop",
    provider: "realearth",
    realearthProduct: "HIMAWARI-night-microphysics",
  },
  {
    id: "daymicro",
    label: "Day microphysics",
    loopLabel: "Day microphysics loop",
    provider: "realearth",
    realearthProduct: "HIMAWARI-day-microphysics-ahi",
    daytimeOnly: true,
  },
] as const;

export const DEFAULT_SATELLITE_PRODUCT: SatelliteProductId = "visible";

export function isSatelliteProductId(value: string): value is SatelliteProductId {
  return SATELLITE_PRODUCTS.some((p) => p.id === value);
}

export function getSatelliteProduct(
  id: SatelliteProductId = DEFAULT_SATELLITE_PRODUCT,
): SatelliteProductMeta {
  return (
    SATELLITE_PRODUCTS.find((p) => p.id === id) ??
    SATELLITE_PRODUCTS.find((p) => p.id === DEFAULT_SATELLITE_PRODUCT)!
  );
}

export type WeatherMapsPayload = {
  generated: number;
  host: string;
  satellite: {
    product: SatelliteProductId;
    source: "rainviewer" | "gibs-himawari" | "realearth-himawari" | "mixed";
    /** Active product frames (also mirrored under products[product]) */
    frames: WeatherFrame[];
    products: Record<SatelliteProductId, { frames: WeatherFrame[] }>;
  };
  radar: {
    past: WeatherFrame[];
    source: "rainviewer";
  };
};

const AEST_TZ = "Australia/Sydney";

/** Australia-Pacific bbox for GIBS WMS IR frames (lon/lat). */
export const GIBS_AU_BOUNDS: [[number, number], [number, number]] = [
  [-48, 105],
  [-5, 165],
];

export type LonLatBounds = [[number, number], [number, number]];

export function lonLatToWebMercator(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  let y =
    Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}

/** Inverse of {@link lonLatToWebMercator}. */
export function webMercatorToLonLat(x: number, y: number): [number, number] {
  const lon = (x / 20037508.34) * 180;
  const latRad =
    2 * Math.atan(Math.exp(((y / 20037508.34) * 180 * Math.PI) / 180)) -
    Math.PI / 2;
  return [lon, (latRad * 180) / Math.PI];
}

/**
 * Project lon/lat into a lon/lat image frame as CSS percentages (Web Mercator).
 */
export function lonLatToBoundsPct(
  lon: number,
  lat: number,
  bounds: LonLatBounds = GIBS_AU_BOUNDS,
): { x: number; y: number } {
  const [[south, west], [north, east]] = bounds;
  const [minx, miny] = lonLatToWebMercator(west, south);
  const [maxx, maxy] = lonLatToWebMercator(east, north);
  const [x, y] = lonLatToWebMercator(lon, lat);
  return {
    x: ((x - minx) / (maxx - minx)) * 100,
    y: ((maxy - y) / (maxy - miny)) * 100,
  };
}

/**
 * Project lon/lat into the national Himawari frame as CSS percentages.
 * Uses Web Mercator so SVG outlines / lightning / synoptic isobars align with GIBS WMS frames.
 */
export function lonLatToGibsPct(lon: number, lat: number): { x: number; y: number } {
  return lonLatToBoundsPct(lon, lat, GIBS_AU_BOUNDS);
}

/** Mercator width/height ratio of a lon/lat bounds box. */
export function boundsMercatorAspect(bounds: LonLatBounds): number {
  const [[south, west], [north, east]] = bounds;
  const [minx, miny] = lonLatToWebMercator(west, south);
  const [maxx, maxy] = lonLatToWebMercator(east, north);
  return (maxx - minx) / (maxy - miny);
}

/** Mercator width/height ratio of GIBS_AU_BOUNDS — keep WMS + map CSS in sync. */
export const GIBS_AU_ASPECT = boundsMercatorAspect(GIBS_AU_BOUNDS);

/** Display width for full satellite frames (sharp national overview). */
export const GIBS_DISPLAY_WIDTH = 1536;

/** Tighter regional crops use a wider raster so zoomed views stay sharp. */
export const GIBS_REGION_DISPLAY_WIDTH = 1920;

/**
 * RealEarth /api/image burns a repeating "Size limit exceeded" overlay when a
 * single export is too large (typically past ~1024px on the long edge / ~0.85MP).
 * Keep RealEarth requests under these caps so we get clean Himawari imagery.
 */
export const RE_MAX_WIDTH = 1024;
export const RE_SAFE_MAX_PIXELS = 850_000;

/** Bump when raster size / watermark / regional source order changes. */
export const FRAME_QUALITY_TAG = "q1020-re-panels-v12";

/**
 * Target long-edge for stitched regional RealEarth mosaics. Built from several
 * smaller panel requests so SSEC's "Size limit exceeded" banner never burns in.
 * Keep modest so serverless frame requests finish inside the 60s budget.
 */
export const RE_STITCH_LONG_EDGE = 960;
/** Per-panel caps — larger single exports intermittently watermark. */
export const RE_PANEL_MAX_EDGE = 640;
export const RE_PANEL_MAX_PIXELS = 240_000;

/** Safe RealEarth raster size for a lon/lat crop (no size-limit overlay). */
export function realEarthRasterSize(
  bounds: LonLatBounds,
  options?: { preferWidth?: number },
): { width: number; height: number } {
  const aspect = boundsMercatorAspect(bounds);
  let width = Math.min(options?.preferWidth ?? RE_MAX_WIDTH, RE_MAX_WIDTH);
  let height = Math.max(1, Math.round(width / aspect));
  const pixels = width * height;
  if (pixels > RE_SAFE_MAX_PIXELS) {
    const scale = Math.sqrt(RE_SAFE_MAX_PIXELS / pixels);
    width = Math.max(320, Math.floor(width * scale));
    height = Math.max(1, Math.round(width / aspect));
  }
  return { width, height };
}

/** Whether a region crop should be fetched as multiple RealEarth panels. */
export function shouldStitchRealEarth(bounds: LonLatBounds): boolean {
  const [[south, west], [north, east]] = bounds;
  const latSpan = Math.abs(north - south);
  const lonSpan = Math.abs(east - west);
  // Large geographic state zooms hit SSEC's size-limit banner as one export —
  // stitch whenever the crop is bigger than a compact metro/state window.
  if (latSpan >= 8 || lonSpan >= 8 || latSpan * lonSpan >= 40) {
    return true;
  }
  const aspect = boundsMercatorAspect(bounds);
  const longEdge = RE_STITCH_LONG_EDGE;
  const width =
    aspect >= 1 ? longEdge : Math.max(1, Math.round(longEdge * aspect));
  const height =
    aspect >= 1 ? Math.max(1, Math.round(longEdge / aspect)) : longEdge;
  return width * height > RE_SAFE_MAX_PIXELS * 0.7;
}
/** Target loop length (~4h at 10-minute Himawari cadence). */
export const SATELLITE_FRAME_COUNT = 24;

/** Himawari full-disk step used across sat / radar matching. */
export const HIMAWARI_STEP_SEC = 10 * 60;

export function gibsHimawariWmsUrl(
  isoTime: string,
  product: SatelliteProductId = DEFAULT_SATELLITE_PRODUCT,
  options?: { width?: number; bounds?: LonLatBounds },
): string {
  const meta = getSatelliteProduct(product);
  if (!meta.gibsLayer) {
    throw new Error(`Product ${product} has no GIBS layer`);
  }
  const bounds = options?.bounds ?? GIBS_AU_BOUNDS;
  const [[south, west], [north, east]] = bounds;
  const [minx, miny] = lonLatToWebMercator(west, south);
  const [maxx, maxy] = lonLatToWebMercator(east, north);
  const aspect = boundsMercatorAspect(bounds);
  const width = options?.width ?? GIBS_DISPLAY_WIDTH;
  const height = Math.max(1, Math.round(width / aspect));
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS: meta.gibsLayer,
    STYLES: "",
    FORMAT: "image/png",
    TRANSPARENT: "FALSE",
    SRS: "EPSG:3857",
    WIDTH: String(width),
    HEIGHT: String(height),
    BBOX: `${minx},${miny},${maxx},${maxy}`,
    TIME: isoTime,
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?${params.toString()}`;
}

/** SSEC RealEarth Australia crop for Himawari products. */
export function realEarthImageUrl(
  realearthProduct: string,
  timeUnix: number,
  options?: { width?: number; height?: number; bounds?: LonLatBounds },
): string {
  const bounds = options?.bounds ?? GIBS_AU_BOUNDS;
  const [[south, west], [north, east]] = bounds;
  const aspect = boundsMercatorAspect(bounds);
  const width = options?.width ?? GIBS_DISPLAY_WIDTH;
  const height =
    options?.height ?? Math.max(1, Math.round(width / aspect));
  const d = new Date(timeUnix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const params = new URLSearchParams({
    products: realearthProduct,
    time,
    bounds: `${south},${west},${north},${east}`,
    width: String(width),
    height: String(height),
  });
  return `https://realearth.ssec.wisc.edu/api/image?${params.toString()}`;
}

/** Parse RealEarth time tokens like 20260916.092000 → unix seconds. */
export function parseRealEarthTimeToken(token: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})$/.exec(token);
  if (!m) return NaN;
  return Math.floor(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ) / 1000,
  );
}

/** Same-origin frame URL used by the player (proxied + cached). */
export function satelliteFrameProxyUrl(
  product: SatelliteProductId,
  timeUnix: number,
  options?: { region?: string },
): string {
  const q = new URLSearchParams({
    product,
    time: String(timeUnix),
    // Bust CDN/browser caches when panel stitch / raster quality changes.
    q: FRAME_QUALITY_TAG,
  });
  if (options?.region && options.region !== "national") {
    q.set("region", options.region);
  }
  return `/api/weather/frame?${q.toString()}`;
}

/** Playback speeds for satellite/radar loops (ms per frame). */
export const PLAYBACK_SPEEDS = [
  { id: "0.5", label: "0.5×", msPerFrame: 1100 },
  { id: "1", label: "1×", msPerFrame: 650 },
  { id: "2", label: "2×", msPerFrame: 360 },
  { id: "4", label: "4×", msPerFrame: 200 },
  { id: "10", label: "10×", msPerFrame: 110 },
] as const;

export type PlaybackSpeedId = (typeof PLAYBACK_SPEEDS)[number]["id"];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeedId = "1";

export function getPlaybackSpeed(
  id: PlaybackSpeedId = DEFAULT_PLAYBACK_SPEED,
): (typeof PLAYBACK_SPEEDS)[number] {
  return PLAYBACK_SPEEDS.find((s) => s.id === id) ?? PLAYBACK_SPEEDS[1]!;
}

export function rainviewerTileUrl(
  host: string,
  path: string,
  kind: "satellite" | "radar" = "satellite",
  options?: { directRadar?: boolean },
): string {
  const base = `${host.replace(/\/$/, "")}${path}`;
  if (kind === "radar") {
    // `directRadar`: RainViewer CDN (Hobby) — skips pngjs recolour proxy CPU.
    if (options?.directRadar) {
      return `${base}/256/{z}/{x}/{y}/0/0_0.png`;
    }
    // Same-origin proxy: RainViewer pixels remapped to CloudCountry dBZ.
    // pal/r must stay in the URL so immutable CDN entries from older palettes
    // cannot mix into playback. `smooth` is flipped client-side by map settings.
    const q = new URLSearchParams({
      host,
      path,
      pal: RADAR_PALETTE_ID,
      r: RADAR_RENDER_REV,
      smooth: "0",
    });
    return `/api/weather/radar-tile?${q.toString()}&z={z}&x={x}&y={y}`;
  }
  return `${base}/256/{z}/{x}/{y}/0/0_0.png`;
}

/**
 * Radar “smoothing” is CSS-only on the client (`skywatch-radar-tiles--smooth`).
 * Never request RainViewer `1_0` — blended Universal Blue pixels fall out of
 * our exact dBZ LUT and the radar looks broken / empty.
 */
export function withRadarSmooth(
  template: string | null | undefined,
  _smooth: boolean,
): string | null {
  if (!template) return null;
  if (/[?&]smooth=\d/.test(template)) {
    return template.replace(/([?&]smooth=)\d/, "$10");
  }
  return template;
}

export function toIsoZ(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function formatFrameTimeAEST(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const formatted = new Intl.DateTimeFormat("en-AU", {
    timeZone: AEST_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  const tzParts = new Intl.DateTimeFormat("en-AU", {
    timeZone: AEST_TZ,
    timeZoneName: "short",
  }).formatToParts(d);
  const tz =
    tzParts.find((p) => p.type === "timeZoneName")?.value ?? "AEST";
  return `${formatted} ${tz}`;
}

export function scrubToFrameIndex(scrub: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  if (frameCount === 1) return 0;
  const clamped = Math.min(100, Math.max(0, scrub));
  return Math.min(
    frameCount - 1,
    Math.round((clamped / 100) * (frameCount - 1)),
  );
}

export function frameIndexToScrub(index: number, frameCount: number): number {
  if (frameCount <= 1) return 100;
  return Math.round((index / (frameCount - 1)) * 100);
}

export function timelineEdgeLabels(
  frames: WeatherFrame[],
): { start: string; mid: string; end: string } {
  if (frames.length === 0) {
    return { start: "—", mid: "—", end: "—" };
  }
  const start = formatFrameTimeAEST(frames[0]!.time);
  const end = formatFrameTimeAEST(frames[frames.length - 1]!.time);
  const mid = formatFrameTimeAEST(
    frames[Math.floor((frames.length - 1) / 2)]!.time,
  );
  return { start, mid, end };
}

/** Closest frame to refUnix. Returns null when farther than maxDeltaSec. */
export function pickWeatherFrame(
  frames: WeatherFrame[],
  refUnix: number,
  maxDeltaSec: number = Number.POSITIVE_INFINITY,
): WeatherFrame | null {
  if (frames.length === 0) return null;
  let best: WeatherFrame | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const delta = Math.abs(frame.time - refUnix);
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  if (!best || bestDelta > maxDeltaSec) return null;
  return best;
}

/**
 * Keep frames that overlap the radar window on the old end, but allow
 * satellite to lead radar when imagery is fresher than RainViewer's past.
 */
export function trimFramesToRadarWindow(
  frames: WeatherFrame[],
  radar: WeatherFrame[],
  padSec = 5 * 60,
): WeatherFrame[] {
  if (frames.length === 0 || radar.length === 0) return frames;
  const start = radar[0]!.time - padSec;
  const trimmed = frames.filter((f) => f.time >= start);
  return trimmed.length >= 3 ? trimmed : frames;
}

/**
 * Prefer satellite's native 10-minute stamps. When radar is available, keep
 * stamps that also land on the radar spine so rain overlays line up — but
 * never drop the newest satellite frames just because radar lags.
 */
export function alignTimesToRadar(
  radarTimesUnix: number[],
  satLatestUnix: number,
  stepSec = HIMAWARI_STEP_SEC,
  maxCount = SATELLITE_FRAME_COUNT,
): number[] {
  if (radarTimesUnix.length === 0) return [];
  const latest = satLatestUnix + stepSec / 2;
  const snapped = new Set<number>();
  for (const t of radarTimesUnix) {
    if (t > latest) continue;
    const s = Math.round(t / stepSec) * stepSec;
    if (s > 0 && s <= latest) snapped.add(s);
  }
  // Always include the newest satellite stamp so the loop tip stays fresh.
  const tip = Math.round(satLatestUnix / stepSec) * stepSec;
  if (tip > 0) snapped.add(tip);
  return [...snapped].sort((a, b) => a - b).slice(-maxCount);
}

/**
 * Contiguous Himawari spine ending at `latestUnix` (inclusive).
 * Always every `stepSec` — never thinned to RainViewer radar stamps.
 */
export function buildContiguousTimeline(
  latestUnix: number,
  maxCount = SATELLITE_FRAME_COUNT,
  stepSec = HIMAWARI_STEP_SEC,
): number[] {
  if (!Number.isFinite(latestUnix) || latestUnix <= 0 || maxCount <= 0) {
    return [];
  }
  const tip = Math.round(latestUnix / stepSec) * stepSec;
  const times: number[] = [];
  for (let i = maxCount - 1; i >= 0; i--) {
    times.push(tip - i * stepSec);
  }
  return times;
}

/**
 * Build a shared Himawari timeline from satellite product times.
 * Fills any missing 10-minute slots so playback never jumps.
 */
export function buildSatelliteTimeline(
  satTimesUnix: number[],
  _radarTimesUnix: number[] = [],
  stepSec = HIMAWARI_STEP_SEC,
  maxCount = SATELLITE_FRAME_COUNT,
): number[] {
  if (satTimesUnix.length === 0) return [];
  const latest = satTimesUnix[satTimesUnix.length - 1]!;
  // Prefer a dense contiguous spine from the tip — radar is matched per-frame
  // in the UI and must not thin the satellite loop.
  return buildContiguousTimeline(latest, maxCount, stepSec);
}
