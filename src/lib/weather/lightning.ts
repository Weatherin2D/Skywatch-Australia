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

/** Match the national satellite frame. */
export const LIGHTNING_AU_BOUNDS = {
  west: 105,
  east: 165,
  south: -48,
  north: -5,
} as const;

export function strikeAgeSeconds(strike: LightningStrike, nowSec: number) {
  return Math.max(0, nowSec - strike.time);
}

/** Visual class by age for the tracker legend / markers. */
export function strikeAgeBand(
  ageSec: number,
): "now" | "recent" | "aging" | "old" {
  if (ageSec < 120) return "now";
  if (ageSec < 10 * 60) return "recent";
  if (ageSec < 20 * 60) return "aging";
  return "old";
}
