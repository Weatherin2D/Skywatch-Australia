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
 * Max age relative to the active frame before a strike icon is removed.
 * Once a stroke is older than this vs the scrubbed/played time, it disappears.
 */
export const LIGHTNING_VISIBLE_WINDOW_SEC = 3 * 60 * 60;

/** Colour ramp matches the visible window (new → fully red at 3h, then gone). */
export const LIGHTNING_COLOR_WINDOW_SEC = LIGHTNING_VISIBLE_WINDOW_SEC;

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

/** Pulse while a strike is still within roughly one IR frame step. */
export function strikeIsFresh(ageSec: number) {
  return ageSec < 12 * 60;
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
 * loop needs strokes that *build* across frames (not a static blob).
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

/** True when buffered history already spans the satellite loop. */
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
  return dataStart <= timelineStart + 30 * 60 && dataSpan >= needSpan * 0.85;
}

/**
 * Stretch onto the satellite loop only when absolute times would leave early
 * frames empty or collapse the whole buffer onto “now”. Never stretch into a
 * long pre-loop window — that freezes a near-full marker field on frame 1.
 */
export function shouldAlignStrikesToTimeline(
  strikes: LightningStrike[],
  loopStart: number,
  loopEnd: number,
): boolean {
  if (strikes.length === 0) return false;
  if (!(loopEnd > loopStart)) return false;

  let dataStart = Infinity;
  let dataEnd = -Infinity;
  for (const s of strikes) {
    if (s.time < dataStart) dataStart = s.time;
    if (s.time > dataEnd) dataEnd = s.time;
  }

  // Identical / near-identical timestamps must be stretched across the loop.
  if (!(dataEnd > dataStart + 60)) return true;

  const loopSpan = loopEnd - loopStart;
  const dataSpan = dataEnd - dataStart;

  // History starts well after the first frame → early frames blank.
  if (dataStart > loopStart + 20 * 60) return true;

  // Buffer much shorter than the IR loop → stretch so storms can build.
  if (dataSpan < loopSpan * 0.5) return true;

  return false;
}

/**
 * Cap visible markers while keeping storm *motion* readable.
 * Biases toward strikes near `refTime` so new cells light up as the loop plays,
 * while still keeping a share of older strokes for context.
 */
export function sampleStrikesForDisplay(
  strikes: LightningStrike[],
  maxVisible: number,
  refTime?: number | null,
): LightningStrike[] {
  if (strikes.length <= maxVisible) {
    return [...strikes].sort((a, b) => b.time - a.time);
  }

  // ~0.2° cells (~20 km) — fine enough that new storm pulses aren't collapsed
  // into the same handful of markers every frame.
  const CELL = 0.2;

  const pickSpatial = (pool: LightningStrike[], limit: number) => {
    if (limit <= 0 || pool.length === 0) return [] as LightningStrike[];
    if (pool.length <= limit) return pool;
    const byCell = new Map<string, LightningStrike>();
    // Newest first so each cell keeps the freshest stroke in-band.
    const ordered = [...pool].sort((a, b) => b.time - a.time);
    for (const s of ordered) {
      const key = `${Math.floor(s.lon / CELL)},${Math.floor(s.lat / CELL)}`;
      if (!byCell.has(key)) byCell.set(key, s);
    }
    let picked = [...byCell.values()];
    if (picked.length > limit) {
      picked.sort((a, b) => b.time - a.time);
      picked = picked.slice(0, limit);
    }
    return picked;
  };

  const recentCut =
    refTime != null && Number.isFinite(refTime) ? refTime - 45 * 60 : null;
  const recent =
    recentCut != null ? strikes.filter((s) => s.time >= recentCut) : [];
  const older =
    recentCut != null ? strikes.filter((s) => s.time < recentCut) : strikes;

  // ~65% of the cap for the leading edge (storm progression), rest for trail.
  const recentBudget = Math.min(
    recent.length,
    Math.max(Math.floor(maxVisible * 0.65), Math.min(recent.length, maxVisible)),
  );
  const olderBudget = maxVisible - recentBudget;

  const pickedRecent = pickSpatial(recent, recentBudget);
  const have = new Set(pickedRecent.map((s) => s.id));
  const pickedOlder = pickSpatial(
    older.filter((s) => !have.has(s.id)),
    Math.max(0, olderBudget),
  );

  let out = [...pickedRecent, ...pickedOlder];
  if (out.length < maxVisible) {
    const seen = new Set(out.map((s) => s.id));
    for (const s of [...strikes].sort((a, b) => b.time - a.time)) {
      if (seen.has(s.id)) continue;
      out.push(s);
      seen.add(s.id);
      if (out.length >= maxVisible) break;
    }
  }

  return out.slice(0, maxVisible).sort((a, b) => b.time - a.time);
}
