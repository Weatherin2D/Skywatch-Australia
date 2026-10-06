/** Client-safe storm cell types + geo helpers (no Node/MQTT imports). */

export type StormCellTrackPoint = {
  lat: number;
  lon: number;
  time: number;
};

export type StormCellAlertLevel = "none" | "watch" | "warning";

export type StormCellProjectedPoint = {
  lat: number;
  lon: number;
  /** Minutes ahead of valid time */
  minutesAhead: number;
};

/** Town expected to be near the cell track, with ETA. */
export type StormCellThreatTown = {
  name: string;
  /** Short state code when known (NSW, VIC, …) */
  state: string;
  lat: number;
  lon: number;
  /** Estimated minutes until the cell centre is nearest this town (0 = already nearby) */
  minutesAhead: number;
  /** Distance from the track / cell to the town (km) */
  distanceKm: number;
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
  /** Forward projection from motion (empty when motion unknown) */
  projectedPath: StormCellProjectedPoint[];
  /** Towns the cell is near now or expected to approach along the track */
  threatTowns: StormCellThreatTown[];
  /** 0–1 severity score for internal ranking */
  strength: number;
  /** Calibrated display score out of 100 */
  score: number;
  alertLevel: StormCellAlertLevel;
  /** Short analysis bullets for details / automated alerts */
  analysis: string[];
  /** One-line summary for alert cards */
  summary: string;
};

export type StormCellAlert = {
  id: string;
  score: number;
  alertLevel: Exclude<StormCellAlertLevel, "none">;
  label: string;
  lat: number;
  lon: number;
  summary: string;
  /** Compact “Town (~30 min)” chips for list cards */
  threatTowns: StormCellThreatTown[];
  href: string;
};

/** Human-readable ETA for a threat town. */
export function formatThreatEta(minutesAhead: number): string {
  if (!Number.isFinite(minutesAhead) || minutesAhead <= 5) return "now";
  if (minutesAhead < 60) return `~${Math.round(minutesAhead)} min`;
  const h = Math.floor(minutesAhead / 60);
  const m = Math.round(minutesAhead % 60);
  if (m === 0) return `~${h} h`;
  return `~${h} h ${m} min`;
}

/** “Dubbo (~30 min), Orange (~60 min)” */
export function formatThreatTownsLine(
  towns: StormCellThreatTown[],
  limit = 4,
): string {
  if (!towns.length) return "";
  return towns
    .slice(0, limit)
    .map((t) => `${t.name} (${formatThreatEta(t.minutesAhead)})`)
    .join(", ");
}

export type StormCellsPayload = {
  generated: number;
  status: string;
  radarValidTime: number | null;
  cells: StormCell[];
  alerts: StormCellAlert[];
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

/** Destination point given start, bearing (deg), and distance (km). */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKmVal: number,
): { lat: number; lon: number } {
  const R = 6371;
  const δ = distanceKmVal / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2));
  return {
    lat: (φ2 * 180) / Math.PI,
    lon: ((((λ2 * 180) / Math.PI) + 540) % 360) - 180,
  };
}

export function alertLevelFromScore(score: number): StormCellAlertLevel {
  if (score >= 75) return "warning";
  if (score >= 55) return "watch";
  return "none";
}

export function compassLabel(deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8]!;
}
