/**
 * Shared Blitzortung strike parsing (safe for browser + Node).
 */

import type { LightningStrike } from "@/lib/weather/lightning";
import { LIGHTNING_AU_BOUNDS } from "@/lib/weather/lightning";

const WINDOW_SEC = 30 * 60;

/** Blitzortung payloads are LZW-compressed binary strings that still start with `{`. */
export function decodeBlitzLzw(binaryStr: string): string {
  const dict: Record<number, string> = {};
  let currChar = binaryStr.charAt(0);
  let oldPhrase = currChar;
  const out = [currChar];
  let code = 256;
  let phrase: string;

  for (let i = 1; i < binaryStr.length; i++) {
    const currCode = binaryStr.charCodeAt(i);
    if (currCode < 256) {
      phrase = binaryStr.charAt(i);
    } else {
      phrase = Object.prototype.hasOwnProperty.call(dict, currCode)
        ? dict[currCode]!
        : oldPhrase + currChar;
    }
    out.push(phrase);
    currChar = phrase.charAt(0);
    dict[code] = oldPhrase + currChar;
    code++;
    oldPhrase = phrase;
  }

  return out.join("");
}

export function parseStrikeMessage(
  raw: string,
): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(decodeBlitzLzw(raw)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export function inLightningBounds(lat: number, lon: number) {
  return (
    lat >= LIGHTNING_AU_BOUNDS.south &&
    lat <= LIGHTNING_AU_BOUNDS.north &&
    lon >= LIGHTNING_AU_BOUNDS.west &&
    lon <= LIGHTNING_AU_BOUNDS.east
  );
}

function normalizeTimeSec(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e16) return Math.floor(n / 1e9);
  if (n > 1e14) return Math.floor(n / 1e6);
  if (n > 1e11) return Math.floor(n / 1e3);
  return Math.floor(n);
}

export function toStrike(
  obj: Record<string, unknown>,
): LightningStrike | null {
  const lat = Number(obj.lat);
  const lon = Number(obj.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!inLightningBounds(lat, lon)) return null;

  const time = normalizeTimeSec(obj.time);
  if (time == null) return null;
  const now = Math.floor(Date.now() / 1000);
  if (time < now - WINDOW_SEC - 120 || time > now + 180) return null;

  const polarityRaw = Number(obj.pol ?? obj.polarity ?? 0);
  const polarity = polarityRaw > 0 ? 1 : polarityRaw < 0 ? -1 : 0;
  const mcg = Number(obj.mcg ?? obj.scs);
  const mds = Number(obj.mds);
  const intensity = Number.isFinite(mcg)
    ? Math.min(80, Math.max(4, mcg / 4))
    : Number.isFinite(mds)
      ? Math.min(80, Math.max(4, mds / 400))
      : 20;

  const id = `bz-${time}-${lat.toFixed(4)}-${lon.toFixed(4)}`;
  return {
    id,
    time,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    polarity,
    intensity: Math.round(intensity * 10) / 10,
  };
}
