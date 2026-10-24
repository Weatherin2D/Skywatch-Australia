import type { MapRegionId } from "@/components/home/mock-data";
import { getMapRegion } from "@/components/home/mock-data";
import type { SatelliteProductId } from "@/lib/weather/maps";
import {
  GIBS_AU_BOUNDS,
  satelliteFrameProxyUrl,
  type WeatherFrame,
} from "@/lib/weather/maps";
import {
  ARCHIVE_STEP_SEC,
  enumerateStamps,
  quantizeArchiveStamp,
  startOfAestDayUnix,
} from "@/lib/weather/archive-time";

/** Loop length in hours (1–48). 24 = full AEST calendar day. */
export type ArchiveLoopHours = number;

export const ARCHIVE_LOOP_MIN_HOURS = 1;
export const ARCHIVE_LOOP_MAX_HOURS = 48;
export const DEFAULT_ARCHIVE_LOOP_HOURS = 4;

/** Preset chips + select options for the archive UI. */
export const ARCHIVE_LOOP_OPTIONS: {
  hours: number;
  label: string;
}[] = [
  { hours: 1, label: "1 hour" },
  { hours: 2, label: "2 hours" },
  { hours: 3, label: "3 hours" },
  { hours: 4, label: "4 hours" },
  { hours: 6, label: "6 hours" },
  { hours: 8, label: "8 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 18, label: "18 hours" },
  { hours: 24, label: "Full day (24h)" },
  { hours: 36, label: "36 hours" },
  { hours: 48, label: "48 hours" },
];

export function clampArchiveLoopHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_ARCHIVE_LOOP_HOURS;
  return Math.min(
    ARCHIVE_LOOP_MAX_HOURS,
    Math.max(ARCHIVE_LOOP_MIN_HOURS, Math.round(hours)),
  );
}

/** Parse `loop` query: `6`, `6h`, `12h`, `24h`. */
export function parseArchiveLoopParam(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2})h?$/i.exec(raw.trim());
  if (!m) return null;
  return clampArchiveLoopHours(Number(m[1]));
}

export function archiveFrameUrl(
  product: SatelliteProductId,
  timeUnix: number,
): string {
  const q = new URLSearchParams({
    product,
    time: String(timeUnix),
  });
  return `/api/weather/archive/frame?${q.toString()}`;
}

/**
 * National archive JPEG when available; regional views use the live frame
 * proxy cropped to the state window (same as the Satellite page).
 */
export function archiveDisplayFrameUrl(
  product: SatelliteProductId,
  timeUnix: number,
  regionId: MapRegionId = "national",
): string {
  if (regionId === "national") return archiveFrameUrl(product, timeUnix);
  return satelliteFrameProxyUrl(product, timeUnix, { region: regionId });
}

/**
 * Build scrub/play frames for the archive loop.
 * - 24h: full AEST calendar day containing the selected time
 * - other lengths: window centered on the selected time
 * - region zooms the raster + bounds (national = archived JPEG)
 */
export function buildArchiveScrubFrames(
  product: SatelliteProductId,
  centerUnix: number,
  epochUnix: number,
  tipUnix: number,
  loopHours: ArchiveLoopHours = DEFAULT_ARCHIVE_LOOP_HOURS,
  availableTimes?: Set<number>,
  regionId: MapRegionId = "national",
): WeatherFrame[] {
  const center = quantizeArchiveStamp(centerUnix);
  const hours = clampArchiveLoopHours(loopHours);
  let from: number;
  let to: number;

  if (hours === 24) {
    from = Math.max(epochUnix, startOfAestDayUnix(center));
    to = Math.min(tipUnix, from + 24 * 3600 - ARCHIVE_STEP_SEC);
  } else {
    const half = (hours * 3600) / 2;
    from = Math.max(epochUnix, center - Math.floor(half));
    to = Math.min(tipUnix, center + Math.ceil(half));
  }

  if (to < from) return [];

  const bounds =
    regionId === "national" ? GIBS_AU_BOUNDS : getMapRegion(regionId).bounds;
  const stamps = enumerateStamps(from, to);
  return stamps
    .filter((t) => !availableTimes || availableTimes.has(t))
    .map((time) => ({
      time,
      imageUrl: archiveDisplayFrameUrl(product, time, regionId),
      imageBounds: bounds,
    }));
}

/** Build an archived radar tile URL: /api/weather/archive/radar-tile?path=&z=&x=&y= */
export function archiveRadarTileUrl(
  path: string,
  z: number,
  x: number,
  y: number,
): string {
  const q = new URLSearchParams({ path, z: String(z), x: String(x), y: String(y) });
  return `/api/weather/archive/radar-tile?${q.toString()}`;
}

/**
 * Build a RainViewer tile URL template for an archived radar frame.
 * The template uses {z}/{x}/{y} placeholders consumed by Leaflet TileLayer.
 */
export function archiveRadarTileTemplate(path: string): string {
  return `/api/weather/archive/radar-tile?path=${encodeURIComponent(path)}&z={z}&x={x}&y={y}`;
}

export { ARCHIVE_STEP_SEC };
