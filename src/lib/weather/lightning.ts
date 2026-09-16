export type LightningStrike = {
  id: string;
  /** Unix seconds */
  time: number;
  lat: number;
  lon: number;
  /** +1 / -1 / 0 */
  polarity: number;
  /** Peak current proxy used for marker size */
  intensity: number;
};

export type LightningPayload = {
  generated: number;
  source: "blitzortung";
  status: "connecting" | "live" | "reconnecting" | "error";
  windowMinutes: number;
  strikes: LightningStrike[];
  attribution: string;
  receivedTotal?: number;
};

export type LightningAgeBand = "new" | "earlier" | "old";

/** Match the national satellite frame. */
export const LIGHTNING_AU_BOUNDS = {
  west: 105,
  east: 165,
  south: -48,
  north: -5,
} as const;

export function strikeAgeSeconds(strike: LightningStrike, refTimeSec: number) {
  return Math.max(0, refTimeSec - strike.time);
}

/**
 * Age vs reference time (active satellite frame, or wall clock on Map/Radar).
 * white = new, yellow = earlier, red = long ago
 */
export function strikeAgeBand(ageSec: number): LightningAgeBand {
  if (ageSec < 120) return "new";
  if (ageSec < 15 * 60) return "earlier";
  return "old";
}

/** Strikes that exist at `refTime` within the rolling lookback window. */
export function filterStrikesAtTime(
  strikes: LightningStrike[],
  refTime: number,
  windowMinutes = 30,
): LightningStrike[] {
  const cutoff = refTime - windowMinutes * 60;
  return strikes
    .filter((s) => s.time <= refTime && s.time >= cutoff)
    .sort((a, b) => b.time - a.time);
}
