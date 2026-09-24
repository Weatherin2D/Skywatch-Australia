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
  receivedInBounds?: number;
};

/** Match the national satellite frame, plus Indian Ocean west of WA. */
export const LIGHTNING_AU_BOUNDS = {
  west: 95,
  east: 170,
  south: -50,
  north: -1,
} as const;

/** Retention window for buffered strikes (seconds).
 * Long enough to cover the full IR loop and keep “really old” strokes. */
export const LIGHTNING_AGE_WINDOW_SEC = 24 * 60 * 60;

/** Colour ramp window — older than this still shows, just fully red. */
export const LIGHTNING_COLOR_WINDOW_SEC = 6 * 60 * 60;

const GRADIENT_STOPS = [
  { t: 0, r: 255, g: 255, b: 255 }, // white — newest
  { t: 0.45, r: 255, g: 202, b: 40 }, // yellow
  { t: 1, r: 239, g: 83, b: 80 }, // red — oldest
] as const;

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function strikeAgeSeconds(strike: LightningStrike, refTimeSec: number) {
  return Math.max(0, refTimeSec - strike.time);
}

/** 0 = brand new, 1 = oldest in the window. */
export function strikeAgeNorm(
  ageSec: number,
  windowSec = LIGHTNING_AGE_WINDOW_SEC,
) {
  return clamp01(ageSec / windowSec);
}

/**
 * Continuous white → yellow → red colour from strike age.
 * Intermediate ages blend between stops (not discrete bands).
 */
export function strikeAgeColor(
  ageSec: number,
  windowSec = LIGHTNING_COLOR_WINDOW_SEC,
): string {
  const t = strikeAgeNorm(ageSec, windowSec);
  let i = 0;
  while (i < GRADIENT_STOPS.length - 2 && t > GRADIENT_STOPS[i + 1]!.t) {
    i += 1;
  }
  const a = GRADIENT_STOPS[i]!;
  const b = GRADIENT_STOPS[i + 1]!;
  const span = b.t - a.t || 1;
  const u = clamp01((t - a.t) / span);
  const r = Math.round(lerp(a.r, b.r, u));
  const g = Math.round(lerp(a.g, b.g, u));
  const bl = Math.round(lerp(a.b, b.b, u));
  return `rgb(${r}, ${g}, ${bl})`;
}

/** Crosshair size scales slightly as strikes age. */
export function strikeAgeSize(
  ageSec: number,
  windowSec = LIGHTNING_COLOR_WINDOW_SEC,
) {
  const t = strikeAgeNorm(ageSec, windowSec);
  return Math.round(lerp(18, 12, t));
}

export function strikeIsFresh(ageSec: number) {
  return ageSec < 90;
}

/** CSS linear-gradient string matching the strike age scale (new → old). */
export function lightningAgeGradientCss() {
  return "linear-gradient(to right, #ffffff 0%, #ffca28 45%, #ef5350 100%)";
}

/**
 * Strikes that have already occurred by `refTime`.
 * Pass `windowMinutes` to limit lookback; omit / null / <=0 to keep every
 * strike at or before the reference time (full history for satellite scrub).
 */
export function filterStrikesAtTime(
  strikes: LightningStrike[],
  refTime: number,
  windowMinutes?: number | null,
): LightningStrike[] {
  const cutoff =
    windowMinutes == null || windowMinutes <= 0
      ? Number.NEGATIVE_INFINITY
      : refTime - windowMinutes * 60;
  return strikes
    .filter((s) => s.time <= refTime && s.time >= cutoff)
    .sort((a, b) => b.time - a.time);
}

/**
 * Stretch strike timestamps so the oldest/newest span `[timelineStart, timelineEnd]`.
 * Used when LightningMaps only carries ~2h of colour ages but the satellite
 * loop (or longer history) needs strokes on every frame.
 */
export function alignStrikesToTimeline(
  strikes: LightningStrike[],
  timelineStart: number,
  timelineEnd: number,
): LightningStrike[] {
  if (strikes.length === 0) return strikes;
  if (!(timelineEnd > timelineStart)) return strikes;
  let dataStart = Infinity;
  let dataEnd = -Infinity;
  for (const s of strikes) {
    if (s.time < dataStart) dataStart = s.time;
    if (s.time > dataEnd) dataEnd = s.time;
  }
  if (!(dataEnd > dataStart)) return strikes;
  const dataSpan = dataEnd - dataStart;
  const outSpan = timelineEnd - timelineStart;
  return strikes.map((s) => {
    const u = (s.time - dataStart) / dataSpan;
    const time = Math.round(timelineStart + u * outSpan);
    return time === s.time ? s : { ...s, time };
  });
}

/** True when buffered history already spans the requested timeline. */
export function strikeHistoryCoversTimeline(
  strikes: LightningStrike[],
  timelineStart: number,
  timelineEnd: number,
): boolean {
  if (strikes.length < 2) return false;
  if (!(timelineEnd > timelineStart)) return true;
  let dataStart = Infinity;
  let dataEnd = -Infinity;
  for (const s of strikes) {
    if (s.time < dataStart) dataStart = s.time;
    if (s.time > dataEnd) dataEnd = s.time;
  }
  if (!(dataEnd > dataStart)) return false;
  const needSpan = timelineEnd - timelineStart;
  const dataSpan = dataEnd - dataStart;
  // Reach near the timeline start and cover most of the requested span.
  return dataStart <= timelineStart + 30 * 60 && dataSpan >= needSpan * 0.85;
}

/**
 * Decide whether to stretch timestamps onto the satellite (+ pre-loop) range.
 * Absolute times win when history is long AND early frames already have
 * enough strokes; otherwise live floods would leave the start of the loop blank.
 */
export function shouldAlignStrikesToTimeline(
  strikes: LightningStrike[],
  timelineStart: number,
  timelineEnd: number,
  /** First satellite frame — used to judge early-loop density. */
  loopStart: number,
): boolean {
  if (strikes.length === 0) return false;
  if (!(timelineEnd > timelineStart)) return false;

  let dataStart = Infinity;
  let dataEnd = -Infinity;
  let beforeLoop = 0;
  for (const s of strikes) {
    if (s.time < dataStart) dataStart = s.time;
    if (s.time > dataEnd) dataEnd = s.time;
    if (s.time <= loopStart) beforeLoop += 1;
  }

  // Identical / near-identical timestamps must be stretched.
  if (!(dataEnd > dataStart + 60)) return true;

  if (!strikeHistoryCoversTimeline(strikes, timelineStart, timelineEnd)) {
    return true;
  }

  // Long span with almost all activity after loopStart → early frames blank.
  const minEarly = Math.min(120, Math.max(40, Math.floor(strikes.length * 0.12)));
  return beforeLoop < minEarly;
}

/**
 * Cap visible markers without favouring only the newest storm cells.
 * Mixes spatial grid picks with age-stratified picks so early satellite
 * frames still show older strokes instead of going blank.
 */
export function sampleStrikesForDisplay(
  strikes: LightningStrike[],
  maxVisible: number,
): LightningStrike[] {
  if (strikes.length <= maxVisible) return strikes;

  // ~0.35° cells across AU — keeps storm structure without DOM overload.
  const CELL = 0.35;
  const byCell = new Map<string, LightningStrike>();
  for (const s of strikes) {
    const key = `${Math.floor(s.lon / CELL)},${Math.floor(s.lat / CELL)}`;
    const prev = byCell.get(key);
    // Prefer the newest strike in each cell (still representative of activity).
    if (!prev || s.time > prev.time) byCell.set(key, s);
  }
  let picked = [...byCell.values()];

  if (picked.length > maxVisible) {
    // Age-stratify so we don't drop all old strokes when the map is busy.
    picked.sort((a, b) => a.time - b.time);
    const buckets = 8;
    const out: LightningStrike[] = [];
    const per = Math.max(1, Math.floor(maxVisible / buckets));
    for (let b = 0; b < buckets; b++) {
      const lo = Math.floor((b * picked.length) / buckets);
      const hi = Math.floor(((b + 1) * picked.length) / buckets);
      const slice = picked.slice(lo, hi);
      // Within each age band, keep the newest (most relevant at that era).
      slice.sort((a, b) => b.time - a.time);
      out.push(...slice.slice(0, per));
    }
    // Fill remainder with globally newest not yet chosen.
    if (out.length < maxVisible) {
      const have = new Set(out.map((s) => s.id));
      const rest = [...picked]
        .sort((a, b) => b.time - a.time)
        .filter((s) => !have.has(s.id));
      out.push(...rest.slice(0, maxVisible - out.length));
    }
    picked = out.slice(0, maxVisible);
  }

  return picked.sort((a, b) => b.time - a.time);
}
