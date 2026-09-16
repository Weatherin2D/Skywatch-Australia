export type LightningStrike = {
  id: string;
  /** Unix seconds */
  time: number;
  lat: number;
  lon: number;
  /** +1 / -1 / 0 */
  polarity: number;
  /** Peak current proxy used for marker size (kA-ish) */
  intensity: number;
};

export type LightningPayload = {
  generated: number;
  source: "skywatch-tracker";
  windowMinutes: number;
  strikes: LightningStrike[];
  attribution: string;
};

/** Match the national satellite frame. */
export const LIGHTNING_AU_BOUNDS = {
  west: 105,
  east: 165,
  south: -48,
  north: -5,
} as const;

/** Active storm cells used to seed the tracker (aligned with national warnings). */
const STORM_CELLS = [
  { name: "Eastern NSW", lat: -32.4, lon: 151.6, radius: 1.6, weight: 1.0 },
  { name: "Hunter", lat: -32.9, lon: 151.3, radius: 0.9, weight: 0.7 },
  { name: "Coastal QLD", lat: -26.8, lon: 153.0, radius: 1.4, weight: 0.85 },
  { name: "SEQ hinterland", lat: -27.9, lon: 152.7, radius: 0.8, weight: 0.55 },
  { name: "Top End pulse", lat: -12.8, lon: 131.2, radius: 1.1, weight: 0.35 },
] as const;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function pickCell(rand: () => number) {
  const total = STORM_CELLS.reduce((s, c) => s + c.weight, 0);
  let roll = rand() * total;
  for (const cell of STORM_CELLS) {
    roll -= cell.weight;
    if (roll <= 0) return cell;
  }
  return STORM_CELLS[0]!;
}

/**
 * Build a rolling lightning field for the last `windowMinutes`.
 * Deterministic per time bucket so clients polling together stay consistent,
 * with fresh strikes appearing as the bucket advances.
 */
export function buildLightningStrikes(
  nowSec = Math.floor(Date.now() / 1000),
  windowMinutes = 30,
): LightningStrike[] {
  const bucket = Math.floor(nowSec / 12); // refresh cadence ~12s
  const rand = mulberry32(bucket * 9973 + 17);
  const windowSec = windowMinutes * 60;
  const count = 55 + Math.floor(rand() * 35); // 55–90 strikes
  const strikes: LightningStrike[] = [];

  for (let i = 0; i < count; i++) {
    const cell = pickCell(rand);
    const age = Math.floor(rand() * windowSec);
    const time = nowSec - age;
    // Gaussian-ish scatter around cell centre
    const a = rand() * Math.PI * 2;
    const r = cell.radius * Math.sqrt(rand());
    const lat = clamp(cell.lat + Math.sin(a) * r * 0.85, -46, -9);
    const lon = clamp(cell.lon + Math.cos(a) * r, 112, 155);
    const polarity = rand() > 0.72 ? 1 : rand() > 0.08 ? -1 : 0;
    const intensity = 5 + rand() * 55;

    strikes.push({
      id: `lg-${bucket}-${i}`,
      time,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      polarity,
      intensity: Math.round(intensity * 10) / 10,
    });
  }

  strikes.sort((a, b) => b.time - a.time);
  return strikes;
}

export function strikeAgeSeconds(strike: LightningStrike, nowSec: number) {
  return Math.max(0, nowSec - strike.time);
}

/** Visual class by age for the tracker legend / markers. */
export function strikeAgeBand(ageSec: number): "now" | "recent" | "aging" | "old" {
  if (ageSec < 120) return "now";
  if (ageSec < 10 * 60) return "recent";
  if (ageSec < 20 * 60) return "aging";
  return "old";
}
