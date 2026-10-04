/** Client-safe storm cell types + geo helpers (no Node/MQTT imports). */

export type StormCellTrackPoint = {
  lat: number;
  lon: number;
  time: number;
};

export type StormCell = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Strikes in the recent 15-minute window */
  strikes15m: number;
  /** Strikes in the recent 45-minute window */
  strikes45m: number;
  ratePerMin: number;
  maxIntensity: number;
  /** Motion toward next estimated position (degrees from north, meteorological) */
  motionDeg: number | null;
  /** Speed km/h from centroid drift */
  speedKmh: number | null;
  /** Short trail: older → newer */
  track: StormCellTrackPoint[];
  /** 0–1 severity score for HUD sorting */
  strength: number;
};

export type StormCellsPayload = {
  generated: number;
  status: string;
  radarValidTime: number | null;
  cells: StormCell[];
  attribution: string;
  note: string;
};

export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
