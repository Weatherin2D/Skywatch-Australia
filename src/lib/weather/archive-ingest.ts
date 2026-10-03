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
const MAX_SAT_STAMPS_PER_RUN = 12;
const MAX_PRODUCTS_PARALLEL = 2;

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
 * Run one ingest cycle: tip stamp + bounded backfill + synoptic + lightning.
 */
export async function runArchiveIngest(): Promise<IngestResult> {
  let meta = await ensureArchiveMeta();
  const now = Math.floor(Date.now() / 1000);
  const tipUnix = quantizeArchiveStamp(now - 60); // allow upstream lag
  const epoch = meta.epochUnix;
  const effectiveTip = Math.max(tipUnix, epoch);

  const stamps = enumerateStamps(epoch, effectiveTip);
  // Prefer newest missing stamps first
  const newestFirst = [...stamps].reverse();

  let satStored = 0;
  let satSkipped = 0;
  let satFailed = 0;
  let stampsWorked = 0;

  for (const stamp of newestFirst) {
    if (stampsWorked >= MAX_SAT_STAMPS_PER_RUN) break;
    for (let i = 0; i < meta.products.length; i += MAX_PRODUCTS_PARALLEL) {
      const batch = meta.products.slice(i, i + MAX_PRODUCTS_PARALLEL);
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

  let synopticStored = 0;
  for (const t of synopticCandidates(epoch, effectiveTip).reverse().slice(0, 4)) {
    if (await ingestSynopticAt(t)) synopticStored += 1;
  }

  const lightningMerged = await ingestLightning(epoch);

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

  const remaining = newestFirst.length; // approximate; UI uses day index
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
