export type WeatherFrame = {
  /** Unix time in seconds */
  time: number;
  /** RainViewer path fragment when available */
  path?: string;
  /** Leaflet-ready tile URL with {z}/{x}/{y} (or GIBS {z}/{y}/{x}) placeholders already ordered */
  tileUrlTemplate: string;
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

export function rainviewerTileUrl(
  host: string,
  path: string,
  kind: "satellite" | "radar" = "satellite",
): string {
  const base = `${host.replace(/\/$/, "")}${path}`;
  // color=0, options=0_0 — valid for both IR and radar per RainViewer docs
  if (kind === "radar") {
    return `${base}/256/{z}/{x}/{y}/2/1_1.png`;
  }
  return `${base}/256/{z}/{x}/{y}/0/0_0.png`;
}

export function gibsHimawariTileUrl(isoTime: string): string {
  // GIBS WMTS uses TileMatrix / TileRow / TileCol → {z}/{y}/{x}
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/${isoTime}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
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
