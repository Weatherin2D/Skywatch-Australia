import { NextRequest, NextResponse } from "next/server";
import { fetchCrossSection } from "@/lib/weather/cross-section";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/weather/cross-section
 *   ?startLat=&startLon=&endLat=&endLon=&field=temperature|rh|wind&model=&time=
 */
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const startLat = Number(
      url.searchParams.get("startLat") ?? url.searchParams.get("lat1"),
    );
    const startLon = Number(
      url.searchParams.get("startLon") ?? url.searchParams.get("lon1"),
    );
    const endLat = Number(
      url.searchParams.get("endLat") ?? url.searchParams.get("lat2"),
    );
    const endLon = Number(
      url.searchParams.get("endLon") ?? url.searchParams.get("lon2"),
    );
    if (
      ![startLat, startLon, endLat, endLon].every((v) => Number.isFinite(v))
    ) {
      return NextResponse.json(
        { error: "startLat, startLon, endLat, endLon are required" },
        { status: 400 },
      );
    }
    const columns = Number(url.searchParams.get("columns"));
    const payload = await fetchCrossSection({
      startLat,
      startLon,
      endLat,
      endLon,
      field: url.searchParams.get("field"),
      model: url.searchParams.get("model"),
      time: url.searchParams.get("time"),
      columns: Number.isFinite(columns) ? columns : undefined,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=90, stale-while-revalidate=180",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Cross-section unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
