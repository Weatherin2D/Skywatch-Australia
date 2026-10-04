import { NextRequest, NextResponse } from "next/server";
import {
  sampleEcmwfMeteogram,
  sampleEcmwfPoint,
} from "@/lib/weather/ecmwf-map";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/weather/ecmwf-map/point?product=&time=&lat=&lon=&model=&diff=
 * GET /api/weather/ecmwf-map/point?series=1&product=&lat=&lon=&model=  (meteogram)
 */
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "lat and lon are required" },
        { status: 400 },
      );
    }
    const model = url.searchParams.get("model");
    const diffModel =
      url.searchParams.get("diff") || url.searchParams.get("diffModel");
    if (
      url.searchParams.get("series") === "1" ||
      url.searchParams.get("meteogram") === "1"
    ) {
      const series = await sampleEcmwfMeteogram({
        productId: url.searchParams.get("product"),
        lat,
        lon,
        model,
      });
      return NextResponse.json(series, {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
        },
      });
    }
    const sample = await sampleEcmwfPoint({
      productId: url.searchParams.get("product"),
      time: url.searchParams.get("time"),
      lat,
      lon,
      model,
      diffModel,
    });
    return NextResponse.json(sample, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Point sample unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
