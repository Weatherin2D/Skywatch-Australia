/**
 * Home upper-air insight panel — observed Sydney Airport radiosonde (UWYO).
 */

import { fetchObservedSounding } from "@/lib/weather/uwyo-sounding";
import type { SoundingLevel } from "@/lib/weather/sounding-types";

export type UpperAirPayload = {
  latitude: number;
  longitude: number;
  placeLabel: string;
  validTime: string | null;
  cape: number | null;
  cin: number | null;
  shearKmh: number | null;
  height500m: number | null;
  temp850C: number | null;
  temp500C: number | null;
  rh850Pct: number | null;
  /** Coarse temp profile for sparkline (top of atmosphere → surface). */
  profile: { label: string; tempC: number | null }[];
  attribution: string;
  /** WMO id when sourced from an observed radiosonde. */
  stationId?: string | null;
  status?: "ok" | "empty";
  message?: string;
};

const SYDNEY_WMO = "94767";

function interpLevel(
  levels: SoundingLevel[],
  pHpa: number,
): SoundingLevel | null {
  if (!levels.length) return null;
  if (pHpa >= levels[0]!.p) return levels[0]!;
  if (pHpa <= levels[levels.length - 1]!.p) return levels[levels.length - 1]!;
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i]!;
    const b = levels[i + 1]!;
    if (pHpa <= a.p && pHpa >= b.p) {
      const w =
        (Math.log(a.p) - Math.log(pHpa)) / (Math.log(a.p) - Math.log(b.p));
      return {
        p: pHpa,
        z: a.z + w * (b.z - a.z),
        t: a.t + w * (b.t - a.t),
        td: a.td + w * (b.td - a.td),
        rh:
          a.rh != null && b.rh != null ? a.rh + w * (b.rh - a.rh) : (a.rh ?? b.rh),
        windDir: a.windDir,
        windSpd:
          a.windSpd != null && b.windSpd != null
            ? a.windSpd + w * (b.windSpd - a.windSpd)
            : (a.windSpd ?? b.windSpd),
      };
    }
  }
  return null;
}

/** Observed Sydney Airport sounding shaped for the home upper-air panel. */
export async function fetchUpperAir(_options?: {
  latitude?: number;
  longitude?: number;
  placeLabel?: string;
}): Promise<UpperAirPayload> {
  // Home panel is fixed to the Sydney observed radiosonde (not model/place).
  const sounding = await fetchObservedSounding({ wmo: SYDNEY_WMO });
  const levels = sounding.levels;
  const sfc = sounding.params.parcels.find((p) => p.id === "SFC");
  const l500 = interpLevel(levels, 500);
  const l850 = interpLevel(levels, 850);
  const l700 = interpLevel(levels, 700);
  const l300 = interpLevel(levels, 300);
  const l1000 = interpLevel(levels, 1000);

  const shearKts = sounding.params.shear0to6Kts;
  const shearKmh =
    shearKts != null && Number.isFinite(shearKts) ? shearKts * 1.852 : null;

  return {
    latitude: sounding.latitude,
    longitude: sounding.longitude,
    placeLabel: "Sydney",
    validTime: sounding.validTime,
    cape: sfc?.cape ?? null,
    cin: sfc?.cin ?? null,
    shearKmh,
    height500m: l500?.z ?? null,
    temp850C: l850?.t ?? null,
    temp500C: l500?.t ?? null,
    rh850Pct: l850?.rh ?? null,
    profile: [
      { label: "300", tempC: l300?.t ?? null },
      { label: "500", tempC: l500?.t ?? null },
      { label: "700", tempC: l700?.t ?? null },
      { label: "850", tempC: l850?.t ?? null },
      { label: "1000", tempC: l1000?.t ?? null },
    ],
    attribution:
      sounding.status === "ok"
        ? "Observed radiosonde · Sydney Airport (UWYO BUFR)"
        : sounding.attribution,
    stationId: SYDNEY_WMO,
    status: sounding.status,
    message: sounding.message,
  };
}
