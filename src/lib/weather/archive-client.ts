import type { SatelliteProductId } from "@/lib/weather/maps";
import { GIBS_AU_BOUNDS, type WeatherFrame } from "@/lib/weather/maps";
import {
  ARCHIVE_STEP_SEC,
  enumerateStamps,
  quantizeArchiveStamp,
  startOfAestDayUnix,
} from "@/lib/weather/archive-time";

export type ArchiveLoopLength = "4h" | "12h" | "24h";

export const ARCHIVE_LOOP_OPTIONS: {
  id: ArchiveLoopLength;
  label: string;
  hours: number;
}[] = [
  { id: "4h", label: "4 hours", hours: 4 },
  { id: "12h", label: "12 hours", hours: 12 },
  { id: "24h", label: "Full day (24h)", hours: 24 },
];

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
 * - 4h / 12h: centered on the selected time
 * - 24h: full AEST calendar day containing the selected time
 */
export function buildArchiveScrubFrames(
  product: SatelliteProductId,
  centerUnix: number,
  epochUnix: number,
  tipUnix: number,
  loop: ArchiveLoopLength = "4h",
  availableTimes?: Set<number>,
): WeatherFrame[] {
  const center = quantizeArchiveStamp(centerUnix);
  let from: number;
  let to: number;

  if (loop === "24h") {
    from = Math.max(epochUnix, startOfAestDayUnix(center));
    to = Math.min(tipUnix, from + 24 * 3600 - ARCHIVE_STEP_SEC);
  } else {
    const half = (loop === "12h" ? 12 : 4) * 3600;
    from = Math.max(epochUnix, center - half);
    to = Math.min(tipUnix, center + half);
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
