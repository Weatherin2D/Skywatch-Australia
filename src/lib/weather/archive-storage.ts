/**
 * Durable archive store for satellite frames, synoptic GeoJSON, and lightning.
 * Preference: Upstash Redis (KV_*) → Vercel Blob → /tmp (dev only).
 * Redis is required for production so frames survive serverless cold starts.
 */

import { promises as fs } from "fs";
import path from "path";
import { get, list, put } from "@vercel/blob";
import { getRedis, redisConfigured } from "@/lib/community/backends";
import type { LightningStrike } from "@/lib/weather/lightning";
import type { SatelliteProductId } from "@/lib/weather/maps";
import { SATELLITE_PRODUCTS } from "@/lib/weather/maps";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import {
  aestPartsToUnix,
  formatAestDateKey,
  formatAestHhmm,
  formatAestHourKey,
  startOfAestDayUnix,
  unixToAestParts,
} from "@/lib/weather/archive-time";

const LOCAL_ROOT = path.join(
  process.env.TMPDIR || "/tmp",
  "skywatch-archive",
);
const BLOB_PREFIX = "archive/";
const META_PATH = "archive/meta.json";
const STEP_SEC = 10 * 60;
/** Rolling 24h sat byte budget before product demotion. */
export const ARCHIVE_SAT_BUDGET_BYTES = 800 * 1024 * 1024;

/** Keep Redis growth bounded (Hobby KV plans are small). */
const REDIS_SAT_TTL_SEC = 14 * 24 * 3600;
const REDIS_SYNOPTIC_TTL_SEC = 21 * 24 * 3600;
const REDIS_LIGHTNING_TTL_SEC = 14 * 24 * 3600;

export const ARCHIVE_PRODUCT_TIERS: SatelliteProductId[][] = [
  SATELLITE_PRODUCTS.map((p) => p.id),
  ["infrared", "visible", "shortwave"],
  ["infrared", "visible"],
];

export type ArchiveMeta = {
  epochUnix: number;
  products: SatelliteProductId[];
  stepSec: number;
  createdAt: string;
  updatedAt: string;
  satBytes24h?: number;
  productTier?: number;
};

export type ArchiveSynopticRecord = {
  stamp: string;
  time: number;
  model: string;
  attribution: string;
  geojson: SynopticGeoJson;
};

export type ArchiveLightningHour = {
  hourUnix: number;
  strikes: LightningStrike[];
  updatedAt: string;
};

export type ArchiveStorageMode = "redis" | "blob" | "local";

type BlobAccess = "public" | "private";

type RedisBinaryRecord = {
  contentType: string;
  data: string;
};

/** Once Blob is known broken (e.g. suspended), stay off Blob for this process. */
let blobDisabled = false;
let blobDisableReason: string | null = null;

function blobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_STORE_ID ||
      (process.env.VERCEL && process.env.VERCEL_OIDC_TOKEN),
  );
}

function useBlobStorage() {
  return blobConfigured() && !blobDisabled;
}

function preferredAccessOrder(): BlobAccess[] {
  const forced = process.env.BLOB_ACCESS?.toLowerCase();
  if (forced === "private") return ["private"];
  if (forced === "public") return ["public"];
  return ["public", "private"];
}

function isBlobFatalError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("suspended") ||
    m.includes("not found") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("access denied") ||
    m.includes("no token") ||
    m.includes("store does not exist")
  );
}

function disableBlob(reason: string) {
  if (blobDisabled) return;
  blobDisabled = true;
  blobDisableReason = reason;
  console.warn(`[archive-storage] Blob disabled — falling back: ${reason}`);
}

function localPath(pathname: string): string {
  return path.join(LOCAL_ROOT, pathname.replace(/^archive\//, ""));
}

async function ensureLocalDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function putLocal(
  pathname: string,
  body: Buffer | string,
): Promise<void> {
  const fp = localPath(pathname);
  await ensureLocalDir(fp);
  await fs.writeFile(fp, body);
}

async function getLocal(pathname: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(localPath(pathname));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

function redisMetaKey() {
  return "archive:meta";
}

function redisSatKey(product: SatelliteProductId, timeUnix: number) {
  const date = formatAestDateKey(timeUnix);
  const hhmm = formatAestHhmm(timeUnix);
  return `archive:sat:${product}:${date}:${hhmm}`;
}

function redisSatDayKey(product: SatelliteProductId, dateKey: string) {
  return `archive:sat:day:${product}:${dateKey}`;
}

function redisSatBoundsKey(product: SatelliteProductId) {
  return `archive:sat:bounds:${product}`;
}

function redisSynopticKey(stamp: string) {
  return `archive:synoptic:${stamp}`;
}

function redisSynopticIndexKey() {
  return "archive:synoptic:index";
}

function redisLightningKey(timeUnix: number) {
  const { y, m, d, h } = formatAestHourKey(timeUnix);
  return `archive:lightning:${y}:${m}:${d}:${h}`;
}

async function redisGetBytes(pathname: string): Promise<Buffer | null> {
  const redis = getRedis();
  if (!redis) return null;
  // Pathname-based keys only used for meta in the blob/local layout.
  if (pathname === META_PATH) {
    const raw = await redis.get(redisMetaKey());
    if (raw == null) return null;
    if (typeof raw === "string") return Buffer.from(raw, "utf8");
    return Buffer.from(JSON.stringify(raw), "utf8");
  }
  return null;
}

async function redisPutMeta(meta: ArchiveMeta): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");
  await redis.set(redisMetaKey(), meta);
}

async function redisGetMeta(): Promise<ArchiveMeta | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(redisMetaKey());
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ArchiveMeta;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as ArchiveMeta;
  return null;
}

async function redisPutSatFrame(
  product: SatelliteProductId,
  timeUnix: number,
  jpeg: Buffer,
): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");
  const stamp = Math.floor(timeUnix);
  const date = formatAestDateKey(stamp);
  const hhmm = formatAestHhmm(stamp);
  const key = redisSatKey(product, stamp);
  const dayKey = redisSatDayKey(product, date);
  const boundsKey = redisSatBoundsKey(product);
  const record: RedisBinaryRecord = {
    contentType: "image/jpeg",
    data: jpeg.toString("base64"),
  };
  const pipeline = redis.pipeline();
  pipeline.set(key, record, { ex: REDIS_SAT_TTL_SEC });
  // Prefix so Upstash does not coerce "1830" into a number on SMEMBERS.
  pipeline.sadd(dayKey, `t${hhmm}`);
  pipeline.expire(dayKey, REDIS_SAT_TTL_SEC);
  await pipeline.exec();

  // Maintain coarse min/max bounds for catalog range.
  try {
    const existing = (await redis.get(boundsKey)) as {
      min?: number;
      max?: number;
    } | null;
    const min =
      existing?.min != null ? Math.min(existing.min, stamp) : stamp;
    const max =
      existing?.max != null ? Math.max(existing.max, stamp) : stamp;
    await redis.set(boundsKey, { min, max }, { ex: REDIS_SAT_TTL_SEC });
  } catch (err) {
    console.warn("[archive-storage] redis bounds update failed", err);
  }
}

async function redisGetSatFrame(
  product: SatelliteProductId,
  timeUnix: number,
): Promise<Buffer | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(redisSatKey(product, timeUnix));
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as RedisBinaryRecord;
  if (typeof rec.data !== "string") return null;
  return Buffer.from(rec.data, "base64");
}

async function redisSatFrameExists(
  product: SatelliteProductId,
  timeUnix: number,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const n = await redis.exists(redisSatKey(product, timeUnix));
  return n === 1;
}

async function redisListSatTimesForDay(
  product: SatelliteProductId,
  dateKey: string,
): Promise<number[]> {
  const redis = getRedis();
  if (!redis) return [];
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return [];
  // Upstash may decode pure-digit set members as numbers — accept both
  // legacy "HHMM" / 1830 and prefixed "tHHMM" forms.
  const members = (await redis.smembers(
    redisSatDayKey(product, dateKey),
  )) as unknown[];
  const times: number[] = [];
  for (const raw of members) {
    let hhmm = String(raw);
    if (hhmm.startsWith("t")) hhmm = hhmm.slice(1);
    hhmm = hhmm.padStart(4, "0");
    if (!/^\d{4}$/.test(hhmm)) continue;
    times.push(
      aestPartsToUnix({
        year: Number(y),
        month: Number(m),
        day: Number(d),
        hour: Number(hhmm.slice(0, 2)),
        minute: Number(hhmm.slice(2, 4)),
      }),
    );
  }
  return times.sort((a, b) => a - b);
}

async function redisFindSatTimeBounds(
  product: SatelliteProductId,
): Promise<{ min: number | null; max: number | null }> {
  const redis = getRedis();
  if (!redis) return { min: null, max: null };
  const raw = (await redis.get(redisSatBoundsKey(product))) as {
    min?: number;
    max?: number;
  } | null;
  if (!raw) return { min: null, max: null };
  return {
    min: typeof raw.min === "number" ? raw.min : null,
    max: typeof raw.max === "number" ? raw.max : null,
  };
}

async function redisPutSynoptic(record: ArchiveSynopticRecord): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");
  const pipeline = redis.pipeline();
  pipeline.set(redisSynopticKey(record.stamp), record, {
    ex: REDIS_SYNOPTIC_TTL_SEC,
  });
  pipeline.zadd(redisSynopticIndexKey(), {
    score: record.time,
    member: record.stamp,
  });
  pipeline.expire(redisSynopticIndexKey(), REDIS_SYNOPTIC_TTL_SEC);
  await pipeline.exec();
}

async function redisGetSynoptic(
  stamp: string,
): Promise<ArchiveSynopticRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(redisSynopticKey(stamp));
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ArchiveSynopticRecord;
    } catch {
      return null;
    }
  }
  return raw as ArchiveSynopticRecord;
}

async function redisListSynopticStamps(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  const stamps = (await redis.zrange(redisSynopticIndexKey(), 0, -1)) as unknown[];
  return stamps
    .map((s) => String(s))
    .filter((s) => /^\d{12}$/.test(s));
}

async function redisGetLightningHour(
  timeUnix: number,
): Promise<ArchiveLightningHour | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(redisLightningKey(timeUnix));
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ArchiveLightningHour;
    } catch {
      return null;
    }
  }
  return raw as ArchiveLightningHour;
}

async function redisPutLightningHour(
  timeUnix: number,
  record: ArchiveLightningHour,
): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");
  await redis.set(redisLightningKey(timeUnix), record, {
    ex: REDIS_LIGHTNING_TTL_SEC,
  });
}

async function redisEstimateSatBytes(): Promise<number> {
  // Approximate from day indexes × typical JPEG size — full SCAN is expensive.
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const today = formatAestDateKey(Math.floor(Date.now() / 1000));
    const yest = formatAestDateKey(Math.floor(Date.now() / 1000) - 86400);
    let frames = 0;
    for (const product of SATELLITE_PRODUCTS.map((p) => p.id)) {
      for (const date of [today, yest]) {
        const n = await redis.scard(redisSatDayKey(product, date));
        frames += typeof n === "number" ? n : 0;
      }
    }
    return frames * 48_000;
  } catch {
    return 0;
  }
}

async function putBlobBytes(
  pathname: string,
  body: Buffer | string,
  contentType: string,
  overwrite = true,
): Promise<boolean> {
  if (!useBlobStorage()) return false;
  const errors: string[] = [];
  for (const access of preferredAccessOrder()) {
    try {
      await put(pathname, body, {
        access,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: overwrite,
        cacheControlMaxAge: 86_400,
      });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`put(${access}): ${msg}`);
      if (isBlobFatalError(msg)) {
        disableBlob(msg);
        break;
      }
    }
  }
  console.warn(
    `[archive-storage] Blob put failed for ${pathname}. ${errors.join(" | ")}`,
  );
  return false;
}

async function getBlobBytes(pathname: string): Promise<Buffer | null> {
  if (!useBlobStorage()) return null;
  for (const access of preferredAccessOrder()) {
    try {
      const result = await get(pathname, { access, useCache: false });
      if (!result || result.statusCode === 304) continue;
      if (!result.stream) continue;
      const ab = await new Response(result.stream).arrayBuffer();
      return Buffer.from(ab);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isBlobFatalError(msg)) {
        disableBlob(msg);
        break;
      }
    }
  }
  return null;
}

async function listBlobPrefix(
  prefix: string,
): Promise<{ pathname: string; size: number }[]> {
  if (!useBlobStorage()) return [];
  try {
    const out: { pathname: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) {
        out.push({ pathname: b.pathname, size: b.size });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isBlobFatalError(msg)) disableBlob(msg);
    console.warn(
      `[archive-storage] Blob list failed for ${prefix}; ${msg}`,
    );
    return [];
  }
}

async function listLocalPrefix(
  prefix: string,
): Promise<{ pathname: string; size: number }[]> {
  const abs = localPath(prefix);
  const out: { pathname: string; size: number }[] = [];
  async function walk(dir: string, basePath: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const nextPath = `${basePath}/${ent.name}`;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, nextPath);
      else {
        const st = await fs.stat(full);
        out.push({ pathname: nextPath, size: st.size });
      }
    }
  }
  await walk(abs, prefix.replace(/\/$/, ""));
  return out;
}

async function putBytes(
  pathname: string,
  body: Buffer | string,
  contentType: string,
  overwrite = true,
): Promise<void> {
  // Meta goes through dedicated redis helpers; this path is blob/local only.
  if (redisConfigured() && pathname === META_PATH) {
    const meta = JSON.parse(
      typeof body === "string" ? body : body.toString("utf8"),
    ) as ArchiveMeta;
    await redisPutMeta(meta);
    // Also mirror locally in dev for easier inspection.
    if (!process.env.VERCEL) {
      await putLocal(pathname, body).catch(() => undefined);
    }
    return;
  }

  const blobOk = await putBlobBytes(pathname, body, contentType, overwrite);
  if (blobOk) return;
  await putLocal(pathname, body);
}

async function getBytes(pathname: string): Promise<Buffer | null> {
  if (redisConfigured() && pathname === META_PATH) {
    const fromRedis = await redisGetBytes(pathname);
    if (fromRedis) return fromRedis;
  }
  const fromBlob = await getBlobBytes(pathname);
  if (fromBlob) return fromBlob;
  return getLocal(pathname);
}

async function listPrefix(
  prefix: string,
): Promise<{ pathname: string; size: number }[]> {
  const fromBlob = await listBlobPrefix(prefix);
  if (fromBlob.length > 0) return fromBlob;
  return listLocalPrefix(prefix);
}

export function satObjectPath(
  product: SatelliteProductId,
  timeUnix: number,
): string {
  const date = formatAestDateKey(timeUnix); // YYYY-MM-DD
  const [y, m, d] = date.split("-");
  const hhmm = formatAestHhmm(timeUnix);
  return `archive/sat/${product}/${y}/${m}/${d}/${hhmm}.jpg`;
}

export function synopticObjectPath(stamp: string): string {
  return `archive/synoptic/${stamp}.json`;
}

export function lightningHourPath(timeUnix: number): string {
  const { y, m, d, h } = formatAestHourKey(timeUnix);
  return `archive/lightning/${y}/${m}/${d}/${h}.json`;
}

export async function readArchiveMeta(): Promise<ArchiveMeta | null> {
  if (redisConfigured()) {
    try {
      const fromRedis = await redisGetMeta();
      if (fromRedis?.epochUnix) return fromRedis;
    } catch (err) {
      console.warn("[archive-storage] redis read meta failed", err);
    }
  }
  const buf = await getBytes(META_PATH);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as ArchiveMeta;
  } catch {
    return null;
  }
}

export async function writeArchiveMeta(meta: ArchiveMeta): Promise<void> {
  if (redisConfigured()) {
    try {
      await redisPutMeta(meta);
      if (!process.env.VERCEL) {
        await putLocal(META_PATH, JSON.stringify(meta, null, 2)).catch(
          () => undefined,
        );
      }
      return;
    } catch (err) {
      console.warn("[archive-storage] redis write meta failed", err);
    }
  }
  await putBytes(META_PATH, JSON.stringify(meta, null, 2), "application/json", true);
}

function defaultArchiveMeta(now = Math.floor(Date.now() / 1000)): ArchiveMeta {
  return {
    epochUnix: startOfAestDayUnix(now),
    products: [...ARCHIVE_PRODUCT_TIERS[0]!],
    stepSec: STEP_SEC,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    productTier: 0,
    satBytes24h: 0,
  };
}

/** Ensure meta exists; epoch is start of AEST today on first create. */
export async function ensureArchiveMeta(): Promise<ArchiveMeta> {
  try {
    const existing = await readArchiveMeta();
    if (existing?.epochUnix) return existing;
  } catch (err) {
    console.warn("[archive-storage] read meta failed", err);
  }
  const meta = defaultArchiveMeta();
  try {
    await writeArchiveMeta(meta);
  } catch (err) {
    // Still serve a catalog — frames/lightning have live fallbacks.
    console.warn("[archive-storage] write meta failed; using ephemeral meta", err);
  }
  return meta;
}

export async function satFrameExists(
  product: SatelliteProductId,
  timeUnix: number,
): Promise<boolean> {
  if (redisConfigured()) {
    try {
      if (await redisSatFrameExists(product, timeUnix)) return true;
    } catch (err) {
      console.warn("[archive-storage] redis exists failed", err);
    }
  }
  const buf = await getBytes(satObjectPath(product, timeUnix));
  return buf != null;
}

export async function putSatFrame(
  product: SatelliteProductId,
  timeUnix: number,
  jpeg: Buffer,
): Promise<void> {
  if (redisConfigured()) {
    try {
      await redisPutSatFrame(product, timeUnix, jpeg);
      if (!process.env.VERCEL) {
        await putLocal(satObjectPath(product, timeUnix), jpeg).catch(
          () => undefined,
        );
      }
      return;
    } catch (err) {
      console.warn("[archive-storage] redis putSatFrame failed", err);
    }
  }
  await putBytes(satObjectPath(product, timeUnix), jpeg, "image/jpeg", true);
}

export async function getSatFrame(
  product: SatelliteProductId,
  timeUnix: number,
): Promise<Buffer | null> {
  if (redisConfigured()) {
    try {
      const fromRedis = await redisGetSatFrame(product, timeUnix);
      if (fromRedis) return fromRedis;
    } catch (err) {
      console.warn("[archive-storage] redis getSatFrame failed", err);
    }
  }
  return getBytes(satObjectPath(product, timeUnix));
}

export async function listSatTimesForDay(
  product: SatelliteProductId,
  dateKey: string,
): Promise<number[]> {
  if (redisConfigured()) {
    try {
      const fromRedis = await redisListSatTimesForDay(product, dateKey);
      if (fromRedis.length > 0) return fromRedis;
    } catch (err) {
      console.warn("[archive-storage] redis listSatTimesForDay", err);
    }
  }
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return [];
  try {
    const prefix = `archive/sat/${product}/${y}/${m}/${d}/`;
    const items = await listPrefix(prefix);
    const times: number[] = [];
    for (const item of items) {
      const base = path.posix.basename(item.pathname, ".jpg");
      if (!/^\d{4}$/.test(base)) continue;
      const hour = Number(base.slice(0, 2));
      const minute = Number(base.slice(2, 4));
      times.push(
        aestPartsToUnix({
          year: Number(y),
          month: Number(m),
          day: Number(d),
          hour,
          minute,
        }),
      );
    }
    return times.sort((a, b) => a - b);
  } catch (err) {
    console.warn("[archive-storage] listSatTimesForDay", err);
    return [];
  }
}

export async function putSynopticRecord(
  record: ArchiveSynopticRecord,
): Promise<void> {
  if (redisConfigured()) {
    try {
      await redisPutSynoptic(record);
      if (!process.env.VERCEL) {
        await putLocal(
          synopticObjectPath(record.stamp),
          JSON.stringify(record),
        ).catch(() => undefined);
      }
      return;
    } catch (err) {
      console.warn("[archive-storage] redis putSynoptic failed", err);
    }
  }
  await putBytes(
    synopticObjectPath(record.stamp),
    JSON.stringify(record),
    "application/json",
    true,
  );
}

export async function getSynopticRecord(
  stamp: string,
): Promise<ArchiveSynopticRecord | null> {
  if (redisConfigured()) {
    try {
      const fromRedis = await redisGetSynoptic(stamp);
      if (fromRedis) return fromRedis;
    } catch (err) {
      console.warn("[archive-storage] redis getSynoptic failed", err);
    }
  }
  const buf = await getBytes(synopticObjectPath(stamp));
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as ArchiveSynopticRecord;
  } catch {
    return null;
  }
}

export async function listSynopticStamps(): Promise<string[]> {
  if (redisConfigured()) {
    try {
      const fromRedis = await redisListSynopticStamps();
      if (fromRedis.length > 0) return fromRedis;
    } catch {
      /* fall through */
    }
  }
  try {
    const items = await listPrefix("archive/synoptic/");
    return items
      .map((i) => path.posix.basename(i.pathname, ".json"))
      .filter((s) => /^\d{12}$/.test(s))
      .sort();
  } catch {
    return [];
  }
}

export async function getLightningHour(
  timeUnix: number,
): Promise<ArchiveLightningHour | null> {
  if (redisConfigured()) {
    try {
      const fromRedis = await redisGetLightningHour(timeUnix);
      if (fromRedis) return fromRedis;
    } catch (err) {
      console.warn("[archive-storage] redis getLightningHour failed", err);
    }
  }
  const buf = await getBytes(lightningHourPath(timeUnix));
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as ArchiveLightningHour;
  } catch {
    return null;
  }
}

export async function mergeLightningHour(
  timeUnix: number,
  strikes: LightningStrike[],
): Promise<number> {
  const hourFloor = hourStartAestUnix(timeUnix);
  const existing = await getLightningHour(timeUnix);
  const map = new Map<string, LightningStrike>();
  for (const s of existing?.strikes ?? []) map.set(s.id, s);
  for (const s of strikes) map.set(s.id, s);
  const merged = [...map.values()].sort((a, b) => a.time - b.time);
  const record: ArchiveLightningHour = {
    hourUnix: existing?.hourUnix ?? hourFloor,
    strikes: merged,
    updatedAt: new Date().toISOString(),
  };
  try {
    if (redisConfigured()) {
      await redisPutLightningHour(timeUnix, record);
      if (!process.env.VERCEL) {
        await putLocal(
          lightningHourPath(timeUnix),
          JSON.stringify(record),
        ).catch(() => undefined);
      }
    } else {
      await putBytes(
        lightningHourPath(timeUnix),
        JSON.stringify(record),
        "application/json",
        true,
      );
    }
  } catch (err) {
    console.warn("[archive-storage] mergeLightningHour persist failed", err);
  }
  return merged.length;
}

/** Strikes across AEST hours overlapping [from, to]. */
export async function getLightningRange(
  fromUnix: number,
  toUnix: number,
): Promise<LightningStrike[]> {
  if (toUnix < fromUnix) return [];
  const seenHours = new Set<string>();
  const strikes: LightningStrike[] = [];
  // Sample every 30 minutes so DST / hour-key edges are covered.
  for (let t = fromUnix; t <= toUnix + 1800; t += 1800) {
    const key = lightningHourPath(t);
    if (seenHours.has(key)) continue;
    seenHours.add(key);
    const hour = await getLightningHour(t);
    if (!hour) continue;
    for (const s of hour.strikes) {
      if (s.time >= fromUnix && s.time <= toUnix) strikes.push(s);
    }
  }
  strikes.sort((a, b) => a.time - b.time);
  return strikes;
}

export async function estimateSatBytesLast24h(): Promise<number> {
  if (redisConfigured()) {
    try {
      const approx = await redisEstimateSatBytes();
      if (approx > 0) return approx;
    } catch {
      /* fall through */
    }
  }
  try {
    const items = await listPrefix("archive/sat/");
    const today = formatAestDateKey(Math.floor(Date.now() / 1000));
    const yest = formatAestDateKey(Math.floor(Date.now() / 1000) - 86400);
    let total = 0;
    for (const item of items) {
      const m = item.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (!m) continue;
      const key = `${m[1]}-${m[2]}-${m[3]}`;
      if (key === today || key === yest) total += item.size;
    }
    return total;
  } catch {
    return 0;
  }
}

/** Earliest / latest sat frame times for a product (best-effort scan). */
export async function findSatTimeBounds(
  product: SatelliteProductId,
): Promise<{ min: number | null; max: number | null }> {
  if (redisConfigured()) {
    try {
      const fromRedis = await redisFindSatTimeBounds(product);
      if (fromRedis.min != null || fromRedis.max != null) return fromRedis;
    } catch (err) {
      console.warn("[archive-storage] redis findSatTimeBounds", err);
    }
  }
  try {
    const items = await listPrefix(`archive/sat/${product}/`);
    let min: number | null = null;
    let max: number | null = null;
    for (const item of items) {
      const m = item.pathname.match(
        /\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{4})\.jpg$/,
      );
      if (!m) continue;
      const t = aestPartsToUnix({
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        hour: Number(m[4]!.slice(0, 2)),
        minute: Number(m[4]!.slice(2, 4)),
      });
      if (min == null || t < min) min = t;
      if (max == null || t > max) max = t;
    }
    return { min, max };
  } catch {
    return { min: null, max: null };
  }
}

export function hourStartAestUnix(unixSec: number): number {
  const p = unixToAestParts(unixSec);
  return aestPartsToUnix({
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: 0,
  });
}

export function demoteProducts(
  currentTier: number,
  bytes24h: number,
): { tier: number; products: SatelliteProductId[] } {
  let tier = Math.max(0, Math.min(currentTier, ARCHIVE_PRODUCT_TIERS.length - 1));
  while (
    bytes24h > ARCHIVE_SAT_BUDGET_BYTES &&
    tier < ARCHIVE_PRODUCT_TIERS.length - 1
  ) {
    tier += 1;
  }
  return {
    tier,
    products: [...ARCHIVE_PRODUCT_TIERS[tier]!],
  };
}

export function archiveStorageMode(): ArchiveStorageMode {
  if (redisConfigured()) return "redis";
  return useBlobStorage() ? "blob" : "local";
}

export function archiveBlobDisableReason(): string | null {
  return blobDisableReason;
}

export { BLOB_PREFIX, META_PATH, LOCAL_ROOT };
