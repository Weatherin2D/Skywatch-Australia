import type { SatelliteProductId } from "@/lib/weather/maps";
import { GIBS_AU_BOUNDS, type WeatherFrame } from "@/lib/weather/maps";
import {
  ARCHIVE_SCRUB_HALF_WINDOW_SEC,
  ARCHIVE_STEP_SEC,
  enumerateStamps,
  quantizeArchiveStamp,
} from "@/lib/weather/archive-time";

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

/** Build a scrub window of expected archive frame slots around `centerUnix`. */
export function buildArchiveScrubFrames(
  product: SatelliteProductId,
  centerUnix: number,
  epochUnix: number,
  tipUnix: number,
  availableTimes?: Set<number>,
): WeatherFrame[] {
  const center = quantizeArchiveStamp(centerUnix);
  const from = Math.max(
    epochUnix,
    center - ARCHIVE_SCRUB_HALF_WINDOW_SEC,
  );
  const to = Math.min(tipUnix, center + ARCHIVE_SCRUB_HALF_WINDOW_SEC);
  const stamps = enumerateStamps(from, to);
  return stamps
    .filter((t) => !availableTimes || availableTimes.has(t))
    .map((time) => ({
      time,
      imageUrl: archiveFrameUrl(product, time),
      imageBounds: GIBS_AU_BOUNDS,
    }));
}

export { ARCHIVE_STEP_SEC, ARCHIVE_SCRUB_HALF_WINDOW_SEC };
