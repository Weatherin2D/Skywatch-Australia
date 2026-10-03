import type { SatelliteProductId } from "@/lib/weather/maps";
import { GIBS_AU_BOUNDS, type WeatherFrame } from "@/lib/weather/maps";
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
 * Build scrub/play frames for the archive loop.
 * - 24h: full AEST calendar day containing the selected time
 * - other lengths: window centered on the selected time
 */
export function buildArchiveScrubFrames(
  product: SatelliteProductId,
  centerUnix: number,
  epochUnix: number,
  tipUnix: number,
  loopHours: ArchiveLoopHours = DEFAULT_ARCHIVE_LOOP_HOURS,
  availableTimes?: Set<number>,
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

  const stamps = enumerateStamps(from, to);
  return stamps
    .filter((t) => !availableTimes || availableTimes.has(t))
    .map((time) => ({
      time,
      imageUrl: archiveFrameUrl(product, time),
      imageBounds: GIBS_AU_BOUNDS,
    }));
}

export { ARCHIVE_STEP_SEC };
