import { GIBS_AU_BOUNDS } from "@/lib/weather/maps";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import {
  SYNOPTIC_MODEL,
  SYNOPTIC_MODEL_LABEL,
} from "@/lib/weather/synoptic-grid";

/** Geographic domain for the national synoptic field (matches satellite frame). */
export const SYNOPTIC_BOUNDS = GIBS_AU_BOUNDS;

export const SYNOPTIC_OPACITY = 0.92;

export const SYNOPTIC_ATTRIBUTION =
  `MSLP + fronts · ${SYNOPTIC_MODEL_LABEL} via Open-Meteo`;

export const SYNOPTIC_PRODUCT = SYNOPTIC_MODEL;

/** Analysis / forecast hours we surface (UTC). */
export const SYNOPTIC_UTC_HOURS = [0, 6, 12, 18] as const;

export type SynopticFrame = {
  /** Valid time unix seconds (UTC) */
  time: number;
  /** Stamp YYYYMMDDHHMM */
  stamp: string;
  /** Same-origin GeoJSON field URL */
  geojsonUrl: string;
};

export type SynopticPayload = {
  generated: number;
  product: string;
  model: string;
  frames: SynopticFrame[];
  latest: SynopticFrame | null;
  /** Latest field embedded to avoid an extra round-trip. */
  geojson: SynopticGeoJson | null;
  validTime: number | null;
  attribution: string;
};

export type SynopticFieldPayload = {
  stamp: string;
  time: number;
  model: string;
  attribution: string;
  geojson: SynopticGeoJson;
};

const STAMP_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function unixToSynopticStamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`
  );
}

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
  return d.getUTCMinutes() === 0;
}

export function synopticFieldUrl(stamp: string): string {
  return `/api/weather/synoptic/frame?time=${encodeURIComponent(stamp)}&fmt=geojson`;
}

export function buildSynopticFrame(stamp: string): SynopticFrame | null {
  const time = synopticStampToUnix(stamp);
  if (time == null) return null;
  return {
    time,
    stamp,
    geojsonUrl: synopticFieldUrl(stamp),
  };
}

/**
 * Candidate 6-hourly valid times (newest first) for the last `days` days.
 */
export function listSynopticCandidateStamps(
  nowSec = Math.floor(Date.now() / 1000),
  days = 2,
): string[] {
  const stamps: string[] = [];
  const now = new Date(nowSec * 1000);
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
      if (unix > nowSec + 3600) continue;
      stamps.push(unixToSynopticStamp(unix));
    }
  }
  return stamps;
}

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
