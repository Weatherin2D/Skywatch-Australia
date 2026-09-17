import { GIBS_AU_BOUNDS } from "@/lib/weather/maps";

/** BoM colour MSLP analysis product code. */
export const SYNOPTIC_PRODUCT = "IDY00030";

/** Cycles issued by BoM (UTC hours). */
export const SYNOPTIC_UTC_HOURS = [0, 6, 12, 18] as const;

/**
 * Geographic bounds for the stretched overlay image in the national frame.
 * Raw BoM charts are scaled uniformly (H/V) into this frame — see synoptic-warp.ts.
 */
export const SYNOPTIC_BOUNDS = GIBS_AU_BOUNDS;

export const SYNOPTIC_OPACITY = 0.7;

export const SYNOPTIC_ATTRIBUTION =
  "Synoptic chart © Commonwealth of Australia, Bureau of Meteorology";

export type SynopticFrame = {
  /** Valid time unix seconds (UTC) */
  time: number;
  /** BoM stamp YYYYMMDDHHMM */
  stamp: string;
  /** Same-origin proxied image URL */
  imageUrl: string;
};

export type SynopticPayload = {
  generated: number;
  product: typeof SYNOPTIC_PRODUCT;
  frames: SynopticFrame[];
  latest: SynopticFrame | null;
  attribution: string;
};

const STAMP_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Format unix seconds as BoM stamp YYYYMMDDHHMM (UTC). */
export function unixToSynopticStamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`
  );
}

/** Parse BoM stamp YYYYMMDDHHMM → unix seconds (UTC). */
export function synopticStampToUnix(stamp: string): number | null {
  const m = STAMP_RE.exec(stamp);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const ms = Date.UTC(y, mo - 1, day, h, mi, 0);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export function isValidSynopticStamp(stamp: string): boolean {
  const unix = synopticStampToUnix(stamp);
  if (unix == null) return false;
  const d = new Date(unix * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return minute === 0 && (SYNOPTIC_UTC_HOURS as readonly number[]).includes(hour);
}

/** Upstream BoM colour analysis PNG. */
export function bomSynopticUpstreamUrl(stamp: string): string {
  return `https://www.bom.gov.au/fwo/${SYNOPTIC_PRODUCT}.${stamp}.png`;
}

/** Same-origin proxy URL for the chart image (warped to national frame). */
export function synopticProxyUrl(stamp: string): string {
  // `w` busts browser caches when the warp/fit changes (must match frame route epoch).
  return `/api/weather/synoptic/frame?time=${encodeURIComponent(stamp)}&w=stretch-v10`;
}

/**
 * Candidate analysis valid times for the last `days` days (newest first).
 * Does not probe HTTP — callers may filter to stamps that exist.
 */
export function listSynopticCandidateStamps(
  nowSec = Math.floor(Date.now() / 1000),
  days = 7,
): string[] {
  const stamps: string[] = [];
  const now = new Date(nowSec * 1000);
  // Walk back day by day, emit 18/12/06/00 for each UTC day
  for (let dayOffset = 0; dayOffset <= days; dayOffset++) {
    const base = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - dayOffset,
        0,
        0,
        0,
      ),
    );
    for (let i = SYNOPTIC_UTC_HOURS.length - 1; i >= 0; i--) {
      const hour = SYNOPTIC_UTC_HOURS[i]!;
      const t = Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        hour,
        0,
        0,
      );
      const unix = Math.floor(t / 1000);
      if (unix > nowSec + 3600) continue; // skip far-future
      stamps.push(unixToSynopticStamp(unix));
    }
  }
  return stamps;
}

export function buildSynopticFrame(stamp: string): SynopticFrame | null {
  const time = synopticStampToUnix(stamp);
  if (time == null) return null;
  return {
    time,
    stamp,
    imageUrl: synopticProxyUrl(stamp),
  };
}

/**
 * Pick the latest analysis at or before `refUnix`.
 * Falls back to the oldest frame if all are after ref (should be rare).
 */
export function pickSynopticFrame(
  frames: SynopticFrame[],
  refUnix: number,
): SynopticFrame | null {
  if (frames.length === 0) return null;
  const sorted = [...frames].sort((a, b) => b.time - a.time);
  for (const frame of sorted) {
    if (frame.time <= refUnix) return frame;
  }
  return sorted[sorted.length - 1] ?? null;
}
