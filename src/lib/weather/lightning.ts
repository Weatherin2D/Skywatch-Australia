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

/** Retention window for buffered strikes (seconds). */
export const LIGHTNING_AGE_WINDOW_SEC = 24 * 60 * 60;

/**
 * Windy-style trail: strikes remain after they flash, then vanish.
 * Hard cut at 3h relative to the animation clock (user requirement).
 */
export const LIGHTNING_VISIBLE_WINDOW_SEC = 3 * 60 * 60;

/** Colour ramp spans the same trail (new → red at 3h, then gone). */
export const LIGHTNING_COLOR_WINDOW_SEC = LIGHTNING_VISIBLE_WINDOW_SEC;

/** Cap for canvas satellite trail (cheap to paint). */
export const LIGHTNING_MAX_VISIBLE = 1200;
/** Cap for Leaflet DOM markers (expensive). */
export const LIGHTNING_MAX_VISIBLE_DOM = 120;

const GRADIENT_STOPS = [
  { t: 0, r: 255, g: 255, b: 255 }, // white — newest flash
  { t: 0.35, r: 255, g: 202, b: 40 }, // yellow
  { t: 1, r: 239, g: 83, b: 80 }, // red — end of trail
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
  windowSec = LIGHTNING_COLOR_WINDOW_SEC,
) {
  return clamp01(ageSec / windowSec);
}

/**
 * Continuous white → yellow → red colour from strike age.
 */
export function strikeAgeColor(
  ageSec: number,
  windowSec = LIGHTNING_COLOR_WINDOW_SEC,
): string {
  const { r, g, b } = strikeAgeRgb(ageSec, windowSec);
  return `rgb(${r}, ${g}, ${b})`;
}

/** RGB components for canvas painting (avoids string parse per strike). */
export function strikeAgeRgb(
  ageSec: number,
  windowSec = LIGHTNING_COLOR_WINDOW_SEC,
): { r: number; g: number; b: number } {
  const t = strikeAgeNorm(ageSec, windowSec);
  let i = 0;
  while (i < GRADIENT_STOPS.length - 2 && t > GRADIENT_STOPS[i + 1]!.t) {
    i += 1;
  }
  const a = GRADIENT_STOPS[i]!;
  const b = GRADIENT_STOPS[i + 1]!;
  const span = b.t - a.t || 1;
  const u = clamp01((t - a.t) / span);
  return {
    r: Math.round(lerp(a.r, b.r, u)),
    g: Math.round(lerp(a.g, b.g, u)),
    b: Math.round(lerp(a.b, b.b, u)),
  };
}

/** Crosshair size scales slightly as strikes age along the trail. */
export function strikeAgeSize(
  ageSec: number,
  windowSec = LIGHTNING_COLOR_WINDOW_SEC,
) {
  const t = strikeAgeNorm(ageSec, windowSec);
  return Math.round(lerp(18, 11, t));
}

/**
 * Windy-style opacity along the trail.
 * Newest flashes are full-bright; older strikes fade so each IR frame’s
 * leading edge is obvious, then vanish at the 3h cut.
 */
export function strikeOpacity(
  ageSec: number,
  windowSec = LIGHTNING_VISIBLE_WINDOW_SEC,
): number {
  if (ageSec < 0) return 0;
  if (ageSec >= windowSec) return 0;
  // ~10 min: full flash (≈ one Himawari step)
  if (ageSec <= 10 * 60) return 1;
  // → 1h: still clear but dimming
  if (ageSec <= 60 * 60) {
    return clamp01(1 - 0.4 * ((ageSec - 10 * 60) / (50 * 60)));
  }
  // → 3h: fade out to the hard cut
  return clamp01(0.6 * (1 - (ageSec - 60 * 60) / (windowSec - 60 * 60)));
}

/** Brief flash window after a strike occurs on the animation clock. */
export function strikeIsFresh(ageSec: number) {
  return ageSec >= 0 && ageSec < 90;
}

/** CSS linear-gradient string matching the strike age scale (new → old). */
export function lightningAgeGradientCss() {
  return "linear-gradient(to right, #ffffff 0%, #ffca28 35%, #ef5350 100%)";
}

/**
 * Strikes that have already occurred by `animTime` and are still inside the
 * Windy-style trail (not older than the visible window).
 * Expects input in any order; returns newest-first.
 */
export function filterStrikesAtTime(
  strikes: LightningStrike[],
  animTime: number,
  windowMinutes?: number | null,
): LightningStrike[] {
  const windowSec =
    windowMinutes == null || windowMinutes <= 0
      ? LIGHTNING_VISIBLE_WINDOW_SEC
      : windowMinutes * 60;
  const cutoff = animTime - windowSec;
  const out: LightningStrike[] = [];
  for (const s of strikes) {
    if (s.time <= animTime && s.time > cutoff) out.push(s);
  }
  out.sort((a, b) => b.time - a.time);
  return out;
}

/**
 * Only used when the live socket dumps identical timestamps (no real ages).
 * Spreads them evenly across the satellite loop so playback still animates.
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

/** True only when timestamps are collapsed (live flood with no history). */
export function shouldAlignStrikesToTimeline(
  strikes: LightningStrike[],
  loopStart: number,
  loopEnd: number,
): boolean {
  if (strikes.length < 2) return false;
  if (!(loopEnd > loopStart)) return false;
  let dataStart = Infinity;
  let dataEnd = -Infinity;
  for (const s of strikes) {
    if (s.time < dataStart) dataStart = s.time;
    if (s.time > dataEnd) dataEnd = s.time;
  }
  return !(dataEnd > dataStart + 60);
}

/**
 * Spatial sample — prefer newest so the flash edge stays dense.
 * Finer cells so adjacent frames don't collapse to the same markers.
 */
export function sampleStrikesForDisplay(
  strikes: LightningStrike[],
  maxVisible: number,
): LightningStrike[] {
  if (strikes.length <= maxVisible) return strikes;

  const CELL = 0.12;
  const byCell = new Map<string, LightningStrike>();
  for (const s of strikes) {
    const key = `${Math.floor(s.lon / CELL)},${Math.floor(s.lat / CELL)}`;
    const prev = byCell.get(key);
    if (!prev || s.time > prev.time) byCell.set(key, s);
  }
  if (byCell.size <= maxVisible) {
    return [...byCell.values()].sort((a, b) => b.time - a.time);
  }
  return [...byCell.values()]
    .sort((a, b) => b.time - a.time)
    .slice(0, maxVisible);
}

/**
 * Windy-style strike set for an animation clock reading.
 */
export function strikesForAnimation(
  strikes: LightningStrike[],
  animTime: number,
  timelineStart?: number | null,
  timelineEnd?: number | null,
  maxVisible: number = LIGHTNING_MAX_VISIBLE,
): LightningStrike[] {
  let working = strikes;

  if (
    timelineStart != null &&
    timelineEnd != null &&
    timelineEnd > timelineStart &&
    strikes.length > 0 &&
    shouldAlignStrikesToTimeline(strikes, timelineStart, timelineEnd)
  ) {
    let dataStart = Infinity;
    for (const s of strikes) {
      if (s.time < dataStart) dataStart = s.time;
    }
    const nudged = strikes.map((s, i) => ({
      ...s,
      time: dataStart - (strikes.length - 1 - i) * 45,
    }));
    working = alignStrikesToTimeline(nudged, timelineStart, timelineEnd);
  }

  const visible = filterStrikesAtTime(
    working,
    animTime,
    Math.round(LIGHTNING_VISIBLE_WINDOW_SEC / 60),
  );
  return sampleStrikesForDisplay(visible, maxVisible);
}
