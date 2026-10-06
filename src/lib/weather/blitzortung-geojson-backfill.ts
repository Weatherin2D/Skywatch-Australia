/**
 * HTTP backfill from Blitzortung map GEOjson strike slots.
 *
 * LightningMaps Mercator PNGs often miss sparse Western Australia strokes
 * that the live map still publishes. `map.blitzortung.org/GEOjson/getjson.php`
 * exposes recent strokes with real UTC timestamps — enough to paint Perth /
 * SW-WA on serverless where WebSockets under-deliver Oceania.
 *
 * Slot format (per row):
 *   [lon, lat, "YYYY-MM-DD HH:MM:SS.fraction", …]
 */

import type { LightningStrike } from "@/lib/weather/lightning";
import { sampleStrikesAcrossTime } from "@/lib/weather/lightning";
import { inLightningBounds } from "@/lib/weather/blitzortung-parse";

const BASE = "https://map.blitzortung.org/GEOjson/getjson.php";
/** Recent slots cover ~the last half hour of global strokes. */
const SLOT_COUNT = 12;
const MAX_STRIKES = 4_000;
const CACHE_TTL_SEC = 45;
const KEEP_SEC = 3 * 60 * 60;
const USER_AGENT =
  "Mozilla/5.0 (compatible; SkyWatchAustralia/1.0; +https://skywatchaustralia.vercel.app)";

export type GeoJsonBackfillResult = {
  strikes: LightningStrike[];
  fetchedAt: number;
};

let cache: GeoJsonBackfillResult | null = null;
let inflight: Promise<GeoJsonBackfillResult> | null = null;

function parseTimeSec(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 1e14) return Math.floor(raw / 1e6);
    if (raw > 1e11) return Math.floor(raw / 1e3);
    return Math.floor(raw);
  }
  if (typeof raw !== "string" || raw.length < 19) return null;
  // "2026-10-06 11:36:59.872293120" — treat as UTC (Blitzortung map convention).
  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/,
  );
  if (!m) return null;
  const msFrac = (m[7] ?? "0").slice(0, 3).padEnd(3, "0");
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${msFrac}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / 1000);
}

function rowToStrike(row: unknown, nowSec: number): LightningStrike | null {
  if (!Array.isArray(row) || row.length < 3) return null;
  const lon = Number(row[0]);
  const lat = Number(row[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!inLightningBounds(lat, lon)) return null;
  const time = parseTimeSec(row[2]);
  if (time == null) return null;
  if (time < nowSec - KEEP_SEC - 60 || time > nowSec + 180) return null;

  // Slot columns after time are not the live-WS mcg/polarity fields —
  // treat [3] as a weak polarity hint and [6] as a size proxy when present.
  const hint = Number(row[3] ?? 0);
  const sizeProxy = Number(row[6]);
  const polarity = hint > 0 ? 1 : hint < 0 ? -1 : 0;
  const intensity = Number.isFinite(sizeProxy)
    ? Math.min(60, Math.max(8, sizeProxy / 4))
    : 22;

  const rLat = Math.round(lat * 1e5) / 1e5;
  const rLon = Math.round(lon * 1e5) / 1e5;
  // Same id family as live sockets so GEOjson + WS dedupe cleanly.
  return {
    id: `bz-${time}-${rLat.toFixed(4)}-${rLon.toFixed(4)}`,
    time,
    lat: rLat,
    lon: rLon,
    polarity,
    intensity: Math.round(intensity * 10) / 10,
  };
}

async function fetchSlot(n: number, nowSec: number): Promise<LightningStrike[]> {
  const url = `${BASE}?f=s&n=${String(n).padStart(2, "0")}&_=${Math.floor(nowSec / 20)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json,text/plain,*/*",
      Referer: "https://map.blitzortung.org/",
      Origin: "https://map.blitzortung.org",
    },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GEOjson HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text[0] !== "[") {
    throw new Error("GEOjson empty or blocked");
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  const out: LightningStrike[] = [];
  for (const row of data) {
    const s = rowToStrike(row, nowSec);
    if (s) out.push(s);
  }
  return out;
}

export async function fetchBlitzortungGeoJsonBackfill(): Promise<GeoJsonBackfillResult> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && now - cache.fetchedAt < CACHE_TTL_SEC) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const jobs = Array.from({ length: SLOT_COUNT }, (_, i) =>
        fetchSlot(i, now).catch((err) => {
          console.error("Blitzortung GEOjson slot failed", i, err);
          return [] as LightningStrike[];
        }),
      );
      const batches = await Promise.all(jobs);
      const byId = new Map<string, LightningStrike>();
      for (const batch of batches) {
        for (const s of batch) {
          const prev = byId.get(s.id);
          if (!prev || s.time >= prev.time) byId.set(s.id, s);
        }
      }
      const fresh = [...byId.values()].filter((s) => now - s.time <= KEEP_SEC);
      const strikes = sampleStrikesAcrossTime(fresh, MAX_STRIKES);
      cache = { strikes, fetchedAt: now };
      if (strikes.length > 0) {
        const wa = strikes.filter((s) => s.lon < 129).length;
        const perth = strikes.filter(
          (s) => s.lon >= 114.5 && s.lon <= 117.5 && s.lat >= -33.5 && s.lat <= -31,
        ).length;
        console.info(
          `[lightning] GEOjson backfill ${strikes.length} AU (WA ${wa}, Perth ${perth})`,
        );
      }
      return cache;
    } catch (err) {
      console.error("Blitzortung GEOjson backfill failed", err);
      return cache ?? { strikes: [], fetchedAt: now };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
