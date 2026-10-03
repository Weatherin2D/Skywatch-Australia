/**
 * Archive ingest: satellite frames, synoptic fields, lightning snapshots.
 */

import sharp from "sharp";
import {
  ARCHIVE_STEP_SEC,
  enumerateStamps,
  quantizeArchiveStamp,
} from "@/lib/weather/archive-time";
import {
  demoteProducts,
  ensureArchiveMeta,
  estimateSatBytesLast24h,
  getSynopticRecord,
  hourStartAestUnix,
  mergeLightningHour,
  putSatFrame,
  putSynopticRecord,
  satFrameExists,
  writeArchiveMeta,
  type ArchiveMeta,
} from "@/lib/weather/archive-storage";
import { getLiveLightningSnapshot } from "@/lib/weather/blitzortung-feed";
import {
  BOM_FRONTS_ATTRIBUTION,
  getBomFrontFeatures,
} from "@/lib/weather/bom-fronts";
import { fetchAndCacheFrameResilient } from "@/lib/weather/fetch-frame";
import {
  GIBS_AU_BOUNDS,
  type SatelliteProductId,
} from "@/lib/weather/maps";
import { contourPressureGrid } from "@/lib/weather/synoptic-contour";
import {
  getSynopticFieldAt,
  SYNOPTIC_MODEL,
} from "@/lib/weather/synoptic-grid";
import {
  SYNOPTIC_ATTRIBUTION,
  SYNOPTIC_UTC_HOURS,
  unixToSynopticStamp,
} from "@/lib/weather/synoptic";

const JPEG_QUALITY = 72;
/** Keep each cron invocation under Vercel maxDuration (~60s). */
const BUDGET_MS = 45_000;
const MAX_BACKFILL_IR_STAMPS = 2;
const MAX_TIP_EXTRA_PRODUCTS = 2;
const MAX_PRODUCTS_PARALLEL = 3;
/** Hobby plan: cron is daily; fill gaps when the archive UI/API is hit. */
export const ARCHIVE_LAZY_INGEST_MIN_INTERVAL_MS = 10 * 60 * 1000;

export type IngestResult = {
  ok: true;
  meta: ArchiveMeta;
  tipUnix: number;
  satStored: number;
  satSkipped: number;
  satFailed: number;
  synopticStored: number;
  lightningMerged: number;
  backfillRemaining: number;
  satBytes24h: number;
};

let lazyIngestInFlight: Promise<IngestResult | null> | null = null;

async function toJpeg(body: Buffer, contentType: string): Promise<Buffer> {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return sharp(body).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  }
  return sharp(body).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

async function ingestSatStamp(
  product: SatelliteProductId,
  timeUnix: number,
): Promise<"stored" | "skipped" | "failed"> {
  if (await satFrameExists(product, timeUnix)) return "skipped";
  try {
    const got = await fetchAndCacheFrameResilient(
      product,
      timeUnix,
      GIBS_AU_BOUNDS,
      "national",
    );
    if (!got) return "failed";
    const jpeg = await toJpeg(got.body, got.contentType);
    await putSatFrame(product, timeUnix, jpeg);
    return "stored";
  } catch (err) {
    console.error(`[archive] sat ${product} @ ${timeUnix}`, err);
    return "failed";
  }
}

async function ingestSynopticAt(unix: number): Promise<boolean> {
  const stamp = unixToSynopticStamp(unix);
  if (await getSynopticRecord(stamp)) return false;
  try {
    const [field, fronts] = await Promise.all([
      getSynopticFieldAt(unix, AbortSignal.timeout(45_000)),
      getBomFrontFeatures(stamp).catch(() => []),
    ]);
    const geojson = contourPressureGrid(field);
    geojson.features.push(...fronts);
    const attribution = fronts.length
      ? `${SYNOPTIC_ATTRIBUTION} · ${BOM_FRONTS_ATTRIBUTION}`
      : SYNOPTIC_ATTRIBUTION;
    await putSynopticRecord({
      stamp,
      time: field.validUnix,
      model: SYNOPTIC_MODEL,
      attribution,
      geojson,
    });
    return true;
  } catch (err) {
    console.error(`[archive] synoptic ${stamp}`, err);
    return false;
  }
}

function synopticCandidates(fromUnix: number, toUnix: number): number[] {
  const out: number[] = [];
  const startDay = new Date(fromUnix * 1000);
  const endDay = new Date(toUnix * 1000);
  for (
    let d = Date.UTC(
      startDay.getUTCFullYear(),
      startDay.getUTCMonth(),
      startDay.getUTCDate(),
    );
    d <=
    Date.UTC(
      endDay.getUTCFullYear(),
      endDay.getUTCMonth(),
      endDay.getUTCDate(),
    );
    d += 86400_000
  ) {
    for (const hour of SYNOPTIC_UTC_HOURS) {
      const t = Math.floor(d / 1000) + hour * 3600;
      if (t >= fromUnix && t <= toUnix) out.push(t);
    }
  }
  return out;
}

async function ingestLightning(sinceUnix: number): Promise<number> {
  try {
    const snap = await getLiveLightningSnapshot();
    const fresh = snap.strikes.filter((s) => s.time >= sinceUnix);
    if (fresh.length === 0) return 0;
    // Group by hour path via first strike times
    const byHour = new Map<number, typeof fresh>();
    for (const s of fresh) {
      const bucket = hourStartAestUnix(s.time);
      const list = byHour.get(bucket) ?? [];
      list.push(s);
      byHour.set(bucket, list);
    }
    let total = 0;
    for (const [hour, strikes] of byHour) {
      total += await mergeLightningHour(hour, strikes);
    }
    return total;
  } catch (err) {
    console.error("[archive] lightning", err);
    return 0;
  }
}

/**
 * Throttled ingest for Hobby (no sub-daily Vercel Cron).
 * Safe to call from catalog/page traffic; no-ops if recently updated.
 */
export async function maybeRunArchiveIngestLazy(
  metaUpdatedAtIso?: string | null,
): Promise<IngestResult | null> {
  const updatedMs = metaUpdatedAtIso
    ? Date.parse(metaUpdatedAtIso)
    : 0;
  if (
    Number.isFinite(updatedMs) &&
    Date.now() - updatedMs < ARCHIVE_LAZY_INGEST_MIN_INTERVAL_MS
  ) {
    return null;
  }
  if (lazyIngestInFlight) return lazyIngestInFlight;
  lazyIngestInFlight = runArchiveIngest()
    .catch((err) => {
      console.error("[archive] lazy ingest failed", err);
      return null;
    })
    .finally(() => {
      lazyIngestInFlight = null;
    });
  return lazyIngestInFlight;
}

/**
 * Run one ingest cycle: lightning + synoptic first, then a bounded sat batch.
 * Products other than infrared are filled across successive cron runs.
 */
export async function runArchiveIngest(): Promise<IngestResult> {
  const started = Date.now();
  const withinBudget = () => Date.now() - started < BUDGET_MS;

  let meta = await ensureArchiveMeta();
  const now = Math.floor(Date.now() / 1000);
  const tipUnix = quantizeArchiveStamp(now - 60); // allow upstream lag
  const epoch = meta.epochUnix;
  const effectiveTip = Math.max(tipUnix, epoch);

  const stamps = enumerateStamps(epoch, effectiveTip);
  const newestFirst = [...stamps].reverse();

  let satStored = 0;
  let satSkipped = 0;
  let satFailed = 0;
  let stampsWorked = 0;

  async function ingestStampProducts(
    stamp: number,
    products: SatelliteProductId[],
  ) {
    for (let i = 0; i < products.length; i += MAX_PRODUCTS_PARALLEL) {
      if (!withinBudget()) return;
      const batch = products.slice(i, i + MAX_PRODUCTS_PARALLEL);
      const results = await Promise.all(
        batch.map((p) => ingestSatStamp(p, stamp)),
      );
      for (const r of results) {
        if (r === "stored") satStored += 1;
        else if (r === "skipped") satSkipped += 1;
        else satFailed += 1;
      }
    }
    stampsWorked += 1;
  }

  const lightningMerged = await ingestLightning(epoch);

  let synopticStored = 0;
  for (const t of synopticCandidates(epoch, effectiveTip).reverse().slice(0, 2)) {
    if (!withinBudget()) break;
    if (await ingestSynopticAt(t)) synopticStored += 1;
  }

  const tip = newestFirst[0];
  if (tip != null && withinBudget()) {
    // Always keep infrared current on the tip.
    await ingestStampProducts(tip, ["infrared"]);
    // Rotate other products that are still missing for this tip.
    const extras: SatelliteProductId[] = [];
    for (const p of meta.products) {
      if (p === "infrared") continue;
      if (await satFrameExists(p, tip)) continue;
      extras.push(p);
      if (extras.length >= MAX_TIP_EXTRA_PRODUCTS) break;
    }
    if (extras.length && withinBudget()) {
      await ingestStampProducts(tip, extras);
    }
  }

  let backfillDone = 0;
  for (const stamp of newestFirst.slice(1)) {
    if (!withinBudget() || backfillDone >= MAX_BACKFILL_IR_STAMPS) break;
    if (await satFrameExists("infrared", stamp)) continue;
    await ingestStampProducts(stamp, ["infrared"]);
    backfillDone += 1;
  }

  const satBytes24h = await estimateSatBytesLast24h();
  const demoted = demoteProducts(meta.productTier ?? 0, satBytes24h);
  meta = {
    ...meta,
    products: demoted.products,
    productTier: demoted.tier,
    satBytes24h,
    updatedAt: new Date().toISOString(),
    stepSec: ARCHIVE_STEP_SEC,
  };
  await writeArchiveMeta(meta);

  return {
    ok: true,
    meta,
    tipUnix: effectiveTip,
    satStored,
    satSkipped,
    satFailed,
    synopticStored,
    lightningMerged,
    backfillRemaining: Math.max(0, stamps.length - stampsWorked),
    satBytes24h,
  };
}
