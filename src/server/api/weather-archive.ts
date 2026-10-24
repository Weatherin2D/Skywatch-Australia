import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { maybeRunArchiveIngestLazy } from "@/lib/weather/archive-ingest";
import {
  ARCHIVE_SCRUB_HALF_WINDOW_SEC,
  ARCHIVE_STEP_SEC,
  formatAestDateKey,
  formatArchiveDateTimeLabel,
  quantizeArchiveStamp,
} from "@/lib/weather/archive-time";
import {
  archiveStorageMode,
  ensureArchiveMeta,
  findSatTimeBounds,
  listSatTimesForDay,
} from "@/lib/weather/archive-storage";
import {
  getSatelliteProduct,
  isSatelliteProductId,
  type SatelliteProductId,
} from "@/lib/weather/maps";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/weather/archive
 * Catalog: meta, range, products, optional day index.
 */
export async function GET(request: NextRequest) {
  try {
    const meta = await ensureArchiveMeta();
    // Hobby Cron is daily only — keep the archive growing when users visit.
    try {
      after(() => {
        void maybeRunArchiveIngestLazy(meta.updatedAt).catch((err) => {
          console.warn("[weather/archive] lazy ingest", err);
        });
      });
    } catch (err) {
      console.warn("[weather/archive] after() unavailable", err);
    }
    const now = Math.floor(Date.now() / 1000);
    const tip = quantizeArchiveStamp(now);
    const productParam = request.nextUrl.searchParams.get("product");
    const product: SatelliteProductId =
      productParam && isSatelliteProductId(productParam)
        ? productParam
        : meta.products[0] ?? "infrared";

    const bounds = await findSatTimeBounds(product).catch(() => ({
      min: null as number | null,
      max: null as number | null,
    }));
    const date =
      request.nextUrl.searchParams.get("date") ??
      formatAestDateKey(Math.min(tip, Math.max(meta.epochUnix, now)));

    const dayTimes = await listSatTimesForDay(product, date).catch(() => []);

    return NextResponse.json(
      {
        generated: now,
        storage: archiveStorageMode(),
        epochUnix: meta.epochUnix,
        epochLabel: formatArchiveDateTimeLabel(meta.epochUnix),
        tipUnix: tip,
        stepSec: ARCHIVE_STEP_SEC,
        scrubHalfWindowSec: ARCHIVE_SCRUB_HALF_WINDOW_SEC,
        products: meta.products.map((id) => ({
          id,
          label: getSatelliteProduct(id).label,
        })),
        productTier: meta.productTier ?? 0,
        satBytes24h: meta.satBytes24h ?? 0,
        range: {
          minUnix: bounds.min ?? meta.epochUnix,
          maxUnix: bounds.max ?? tip,
        },
        date,
        product,
        times: dayTimes,
        attribution: {
          satellite: "Himawari imagery via RealEarth / NASA GIBS",
          synoptic: "MSLP · GFS via Open-Meteo · fronts from BoM IDY00030",
          lightning:
            "Lightning © Blitzortung.org / LightningMaps.org (CC BY-SA) — entertainment only, not for official warning use",
          radar: "Radar © RainViewer",
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
        },
      },
    );
  } catch (err) {
    console.error("[weather/archive]", err);
    // Last-resort catalog so the Archive UI can still open and use live fallbacks.
    const now = Math.floor(Date.now() / 1000);
    const tip = quantizeArchiveStamp(now);
    const epochUnix = tip - (tip % (24 * 3600));
    return NextResponse.json(
      {
        generated: now,
        storage: "local",
        epochUnix,
        epochLabel: formatArchiveDateTimeLabel(epochUnix),
        tipUnix: tip,
        stepSec: ARCHIVE_STEP_SEC,
        scrubHalfWindowSec: ARCHIVE_SCRUB_HALF_WINDOW_SEC,
        products: [
          { id: "infrared", label: getSatelliteProduct("infrared").label },
          { id: "visible", label: getSatelliteProduct("visible").label },
          { id: "shortwave", label: getSatelliteProduct("shortwave").label },
        ],
        productTier: 0,
        satBytes24h: 0,
        range: { minUnix: epochUnix, maxUnix: tip },
        date: formatAestDateKey(tip),
        product: "infrared",
        times: [],
        degraded: true,
        attribution: {
          satellite: "Himawari imagery via RealEarth / NASA GIBS",
          synoptic: "MSLP · GFS via Open-Meteo · fronts from BoM IDY00030",
          lightning:
            "Lightning © Blitzortung.org / LightningMaps.org (CC BY-SA) — entertainment only, not for official warning use",
          radar: "Radar © RainViewer",
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
