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
export const LIGHTNING_MAX_VISIBLE = 1600;
/** Cap for Leaflet DOM markers (expensive). */
export const LIGHTNING_MAX_VISIBLE_DOM = 220;
/** Cap for archive API payloads (keeps the client responsive). */
export const LIGHTNING_ARCHIVE_MAX_STRIKES = 2400;

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

/** Crosshair / bolt size scales slightly as strikes age along the trail. */
export function strikeAgeSize(
  ageSec: number,
  windowSec = LIGHTNING_COLOR_WINDOW_SEC,
) {
  const t = strikeAgeNorm(ageSec, windowSec);
  // Large enough to read as bolt/crosshair icons over national IR.
  return Math.max(14, Math.round(lerp(24, 15, t)));
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
 * Stretch strike times across the satellite loop.
 * Used when history is collapsed or shorter than the IR window so every
 * frame still gets a progressive trail (Windy-style playback).
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

function strikeTimeSpan(strikes: LightningStrike[]): {
  dataStart: number;
  dataEnd: number;
} {
  let dataStart = Infinity;
  let dataEnd = -Infinity;
  for (const s of strikes) {
    if (s.time < dataStart) dataStart = s.time;
    if (s.time > dataEnd) dataEnd = s.time;
  }
  return { dataStart, dataEnd };
}

/**
 * Align when timestamps are collapsed, or when strike history does not reach
 * the start of the IR loop (would leave early frames empty).
 */
export function shouldAlignStrikesToTimeline(
  strikes: LightningStrike[],
  loopStart: number,
  loopEnd: number,
): boolean {
  if (strikes.length < 2) return false;
  if (!(loopEnd > loopStart)) return false;
  const { dataStart, dataEnd } = strikeTimeSpan(strikes);
  if (!(dataEnd > dataStart + 60)) return true;
  const loopSpan = loopEnd - loopStart;
  const dataSpan = dataEnd - dataStart;
  // History starts after the first IR frame → early frames would be blank.
  if (dataStart > loopStart + 5 * 60) return true;
  // History much shorter than the loop → stretch so motion fills playback.
  if (dataSpan < loopSpan * 0.55) return true;
  return false;
}

/**
 * Coarse longitude bands across the AU domain.
 * Keeps WA / central Australia from being starved when the east coast is busy.
 */
export function lightningLonBand(lon: number): number {
  if (lon < 120) return 0; // WA west / Indian Ocean
  if (lon < 129) return 1; // WA east / western NT
  if (lon < 138) return 2; // central
  if (lon < 147) return 3; // inland east
  return 4; // east coast / Tasman
}

export const LIGHTNING_LON_BAND_COUNT = 5;

/**
 * Spatial sample — prefer newest so the flash edge stays dense, but reserve
 * quota per longitude band so eastern storms cannot wipe WA from capped views.
 */
export function sampleStrikesForDisplay(
  strikes: LightningStrike[],
  maxVisible: number,
): LightningStrike[] {
  if (strikes.length <= maxVisible) return strikes;

  const CELL = 0.1;
  const byCell = new Map<string, LightningStrike>();
  for (const s of strikes) {
    const key = `${Math.floor(s.lon / CELL)},${Math.floor(s.lat / CELL)}`;
    const prev = byCell.get(key);
    if (!prev || s.time > prev.time) byCell.set(key, s);
  }
  const cells = [...byCell.values()].sort((a, b) => b.time - a.time);
  if (cells.length <= maxVisible) return cells;

  const bands: LightningStrike[][] = Array.from(
    { length: LIGHTNING_LON_BAND_COUNT },
    () => [],
  );
  for (const s of cells) {
    bands[lightningLonBand(s.lon)]!.push(s);
  }

  const perBand = Math.max(12, Math.floor(maxVisible / LIGHTNING_LON_BAND_COUNT));
  const picked: LightningStrike[] = [];
  const seen = new Set<string>();
  for (const band of bands) {
    let n = 0;
    for (const s of band) {
      if (n >= perBand) break;
      picked.push(s);
      seen.add(s.id);
      n += 1;
    }
  }
  for (const s of cells) {
    if (picked.length >= maxVisible) break;
    if (seen.has(s.id)) continue;
    picked.push(s);
    seen.add(s.id);
  }
  return picked.sort((a, b) => b.time - a.time);
}

/**
 * Sample strikes evenly across time buckets so every archive frame keeps a
 * trail, while capping payload size for the browser.
 */
export function sampleStrikesAcrossTime(
  strikes: LightningStrike[],
  maxTotal: number = LIGHTNING_ARCHIVE_MAX_STRIKES,
  bucketSec = 600,
): LightningStrike[] {
  if (strikes.length <= maxTotal) {
    return [...strikes].sort((a, b) => a.time - b.time);
  }
  const buckets = new Map<number, LightningStrike[]>();
  for (const s of strikes) {
    const key = Math.floor(s.time / bucketSec) * bucketSec;
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const perBucket = Math.max(12, Math.ceil(maxTotal / Math.max(1, keys.length)));
  const out: LightningStrike[] = [];
  for (const key of keys) {
    out.push(...sampleStrikesForDisplay(buckets.get(key)!, perBucket));
  }
  if (out.length <= maxTotal) {
    return out.sort((a, b) => a.time - b.time);
  }
  return sampleStrikesForDisplay(out, maxTotal).sort((a, b) => a.time - b.time);
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
    const { dataStart, dataEnd } = strikeTimeSpan(strikes);
    let toAlign = strikes;
    if (!(dataEnd > dataStart + 60)) {
      // Collapsed live flood — invent a short progression then stretch.
      toAlign = strikes.map((s, i) => ({
        ...s,
        time: dataStart - (strikes.length - 1 - i) * 45,
      }));
    }
    working = alignStrikesToTimeline(toAlign, timelineStart, timelineEnd);
  }

  const visible = filterStrikesAtTime(
    working,
    animTime,
    Math.round(LIGHTNING_VISIBLE_WINDOW_SEC / 60),
  );
  return sampleStrikesForDisplay(visible, maxVisible);
}
