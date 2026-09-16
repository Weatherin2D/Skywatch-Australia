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

export type SatelliteProductId = "visible" | "infrared" | "airmass";

export type SatelliteProductMeta = {
  id: SatelliteProductId;
  label: string;
  loopLabel: string;
  gibsLayer: string;
  /** Daytime-only products may return empty frames overnight */
  daytimeOnly?: boolean;
};

export const SATELLITE_PRODUCTS: readonly SatelliteProductMeta[] = [
  {
    id: "visible",
    label: "Visible",
    loopLabel: "Visible loop",
    gibsLayer: "Himawari_AHI_Band3_Red_Visible_1km",
    daytimeOnly: true,
  },
  {
    id: "infrared",
    label: "Infrared",
    loopLabel: "Infrared loop",
    gibsLayer: "Himawari_AHI_Band13_Clean_Infrared",
  },
  {
    id: "airmass",
    label: "Air Mass",
    loopLabel: "Air Mass loop",
    gibsLayer: "Himawari_AHI_Air_Mass",
  },
] as const;

export const DEFAULT_SATELLITE_PRODUCT: SatelliteProductId = "infrared";

export function isSatelliteProductId(value: string): value is SatelliteProductId {
  return SATELLITE_PRODUCTS.some((p) => p.id === value);
}

export function getSatelliteProduct(
  id: SatelliteProductId = DEFAULT_SATELLITE_PRODUCT,
): SatelliteProductMeta {
  return SATELLITE_PRODUCTS.find((p) => p.id === id) ?? SATELLITE_PRODUCTS[1]!;
}

export type WeatherMapsPayload = {
  generated: number;
  host: string;
  satellite: {
    product: SatelliteProductId;
    source: "rainviewer" | "gibs-himawari";
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

export function lonLatToWebMercator(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  let y =
    Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}

/** Mercator width/height ratio of GIBS_AU_BOUNDS — keep WMS + map CSS in sync. */
export const GIBS_AU_ASPECT =
  (() => {
    const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
    const [minx, miny] = lonLatToWebMercator(west, south);
    const [maxx, maxy] = lonLatToWebMercator(east, north);
    return (maxx - minx) / (maxy - miny);
  })();

/** Display width for full satellite frames (balanced sharpness vs load time). */
export const GIBS_DISPLAY_WIDTH = 1024;

export function gibsHimawariWmsUrl(
  isoTime: string,
  product: SatelliteProductId = DEFAULT_SATELLITE_PRODUCT,
  options?: { width?: number },
): string {
  const meta = getSatelliteProduct(product);
  const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
  const [minx, miny] = lonLatToWebMercator(west, south);
  const [maxx, maxy] = lonLatToWebMercator(east, north);
  const width = options?.width ?? GIBS_DISPLAY_WIDTH;
  const height = Math.max(1, Math.round(width / GIBS_AU_ASPECT));
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

/** Same-origin frame URL used by the player (proxied + cached). */
export function satelliteFrameProxyUrl(
  product: SatelliteProductId,
  timeUnix: number,
): string {
  const q = new URLSearchParams({
    product,
    time: String(timeUnix),
  });
  return `/api/weather/frame?${q.toString()}`;
}

/** Playback speeds for satellite/radar loops (ms per frame). */
export const PLAYBACK_SPEEDS = [
  { id: "0.5", label: "0.5×", msPerFrame: 1000 },
  { id: "1", label: "1×", msPerFrame: 500 },
  { id: "2", label: "2×", msPerFrame: 280 },
  { id: "4", label: "4×", msPerFrame: 160 },
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
): string {
  const base = `${host.replace(/\/$/, "")}${path}`;
  if (kind === "radar") {
    return `${base}/256/{z}/{x}/{y}/2/1_1.png`;
  }
  return `${base}/256/{z}/{x}/{y}/0/0_0.png`;
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
