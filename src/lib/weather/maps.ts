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

export type WeatherMapsPayload = {
  generated: number;
  host: string;
  satellite: {
    infrared: WeatherFrame[];
    source: "rainviewer" | "gibs-himawari";
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

export function gibsHimawariWmsUrl(isoTime: string): string {
  const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
  const [minx, miny] = lonLatToWebMercator(west, south);
  const [maxx, maxy] = lonLatToWebMercator(east, north);
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS: "Himawari_AHI_Band13_Clean_Infrared",
    STYLES: "",
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
    SRS: "EPSG:3857",
    WIDTH: "1280",
    HEIGHT: "720",
    BBOX: `${minx},${miny},${maxx},${maxy}`,
    TIME: isoTime,
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?${params.toString()}`;
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
