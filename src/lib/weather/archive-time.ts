/** AEST/AEDT archive time helpers (Australia/Sydney). */

export const ARCHIVE_TZ = "Australia/Sydney";
export const ARCHIVE_STEP_SEC = 10 * 60;
export const ARCHIVE_SCRUB_HALF_WINDOW_SEC = 2 * 60 * 60;

const pad2 = (n: number) => String(n).padStart(2, "0");

export type AestParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Calendar parts for a unix instant in Australia/Sydney. */
export function unixToAestParts(unixSec: number): AestParts {
  const d = new Date(unixSec * 1000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ARCHIVE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
  };
}

/**
 * Convert AEST wall-clock parts to unix seconds.
 * Uses iterative refinement against Intl (handles DST).
 */
export function aestPartsToUnix(parts: AestParts): number {
  let guess = Math.floor(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour - 10, parts.minute, 0) /
      1000,
  );
  for (let i = 0; i < 4; i++) {
    const got = unixToAestParts(guess);
    const targetMin =
      parts.year * 525600 +
      parts.month * 44640 +
      parts.day * 1440 +
      parts.hour * 60 +
      parts.minute;
    const gotMin =
      got.year * 525600 +
      got.month * 44640 +
      got.day * 1440 +
      got.hour * 60 +
      got.minute;
    const deltaMin = targetMin - gotMin;
    if (deltaMin === 0) break;
    guess += deltaMin * 60;
  }
  return guess;
}

/** Start of the Sydney calendar day containing `unixSec` (or now). */
export function startOfAestDayUnix(unixSec = Math.floor(Date.now() / 1000)): number {
  const p = unixToAestParts(unixSec);
  return aestPartsToUnix({
    year: p.year,
    month: p.month,
    day: p.day,
    hour: 0,
    minute: 0,
  });
}

/** Floor unix to the previous completed 10-minute stamp. */
export function quantizeArchiveStamp(unixSec: number): number {
  return Math.floor(unixSec / ARCHIVE_STEP_SEC) * ARCHIVE_STEP_SEC;
}

export function formatAestDateKey(unixSec: number): string {
  const p = unixToAestParts(unixSec);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function formatAestHhmm(unixSec: number): string {
  const p = unixToAestParts(unixSec);
  return `${pad2(p.hour)}${pad2(p.minute)}`;
}

export function formatAestHourKey(unixSec: number): {
  y: string;
  m: string;
  d: string;
  h: string;
} {
  const p = unixToAestParts(unixSec);
  return {
    y: String(p.year),
    m: pad2(p.month),
    d: pad2(p.day),
    h: pad2(p.hour),
  };
}

export function formatArchiveDateTimeLabel(unixSec: number): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: ARCHIVE_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(unixSec * 1000));
}

/** Inclusive list of 10-min stamps from `from` to `to` (unix, already quantized). */
export function enumerateStamps(fromUnix: number, toUnix: number): number[] {
  const start = quantizeArchiveStamp(fromUnix);
  const end = quantizeArchiveStamp(toUnix);
  if (end < start) return [];
  const out: number[] = [];
  for (let t = start; t <= end; t += ARCHIVE_STEP_SEC) out.push(t);
  return out;
}
