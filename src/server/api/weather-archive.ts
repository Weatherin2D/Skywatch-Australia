import { NextRequest, NextResponse } from "next/server";
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
    const now = Math.floor(Date.now() / 1000);
    const tip = quantizeArchiveStamp(now);
    const productParam = request.nextUrl.searchParams.get("product");
    const product: SatelliteProductId =
      productParam && isSatelliteProductId(productParam)
        ? productParam
        : meta.products[0] ?? "infrared";

    const bounds = await findSatTimeBounds(product);
    const date =
      request.nextUrl.searchParams.get("date") ??
      formatAestDateKey(Math.min(tip, Math.max(meta.epochUnix, now)));

    const dayTimes = await listSatTimesForDay(product, date);

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
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    console.error("[weather/archive]", err);
    return NextResponse.json(
      { error: "Archive catalog unavailable" },
      { status: 500 },
    );
  }
}
