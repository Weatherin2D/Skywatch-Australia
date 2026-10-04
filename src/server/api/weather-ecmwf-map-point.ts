import { NextRequest, NextResponse } from "next/server";
import { sampleEcmwfPoint } from "@/lib/weather/ecmwf-map";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/weather/ecmwf-map/point?product=&time=&lat=&lon=
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
    const sample = await sampleEcmwfPoint({
      productId: url.searchParams.get("product"),
      time: url.searchParams.get("time"),
      lat,
      lon,
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
