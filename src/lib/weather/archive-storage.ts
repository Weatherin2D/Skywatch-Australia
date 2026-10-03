/**
 * Durable archive store for satellite frames, synoptic GeoJSON, and lightning.
 * Prefers Vercel Blob; falls back to /tmp/skywatch-archive when Blob is
 * unavailable (missing token, suspended store, network errors).
 */

import { promises as fs } from "fs";
import path from "path";
import { get, list, put } from "@vercel/blob";
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

type BlobAccess = "public" | "private";

/** Once Blob is known broken (e.g. suspended), stay on local for this process. */
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
  console.warn(`[archive-storage] Blob disabled — falling back to local: ${reason}`);
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

async function putBytes(
  pathname: string,
  body: Buffer | string,
  contentType: string,
  overwrite = true,
): Promise<void> {
  if (useBlobStorage()) {
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
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`put(${access}): ${msg}`);
        if (isBlobFatalError(msg)) {
          disableBlob(msg);
          break;
        }
      }
    }
    // Soft-fail to local so the archive catalog/UI stays up.
    console.warn(
      `[archive-storage] Blob put failed for ${pathname}; using local. ${errors.join(" | ")}`,
    );
  }
  await putLocal(pathname, body);
}

async function getBytes(pathname: string): Promise<Buffer | null> {
  if (useBlobStorage()) {
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
  }
  return getLocal(pathname);
}

async function exists(pathname: string): Promise<boolean> {
  const buf = await getBytes(pathname);
  return buf != null;
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

async function listPrefix(
  prefix: string,
): Promise<{ pathname: string; size: number }[]> {
  if (useBlobStorage()) {
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
        `[archive-storage] Blob list failed for ${prefix}; using local. ${msg}`,
      );
    }
  }
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
  const buf = await getBytes(META_PATH);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as ArchiveMeta;
  } catch {
    return null;
  }
}

export async function writeArchiveMeta(meta: ArchiveMeta): Promise<void> {
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
  return exists(satObjectPath(product, timeUnix));
}

export async function putSatFrame(
  product: SatelliteProductId,
  timeUnix: number,
  jpeg: Buffer,
): Promise<void> {
  await putBytes(satObjectPath(product, timeUnix), jpeg, "image/jpeg", true);
}

export async function getSatFrame(
  product: SatelliteProductId,
  timeUnix: number,
): Promise<Buffer | null> {
  return getBytes(satObjectPath(product, timeUnix));
}

export async function listSatTimesForDay(
  product: SatelliteProductId,
  dateKey: string,
): Promise<number[]> {
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
  const buf = await getBytes(synopticObjectPath(stamp));
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as ArchiveSynopticRecord;
  } catch {
    return null;
  }
}

export async function listSynopticStamps(): Promise<string[]> {
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
    await putBytes(
      lightningHourPath(timeUnix),
      JSON.stringify(record),
      "application/json",
      true,
    );
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

export function archiveStorageMode(): "blob" | "local" {
  return useBlobStorage() ? "blob" : "local";
}

export function archiveBlobDisableReason(): string | null {
  return blobDisableReason;
}

export { BLOB_PREFIX, META_PATH, LOCAL_ROOT };
