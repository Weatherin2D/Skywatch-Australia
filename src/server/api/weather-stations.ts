import { NextResponse } from "next/server";
import { getLiveStationsCached } from "@/lib/weather/stations";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/weather/stations
 * Live AU weather-station observations for station-model map overlays.
 */
export async function GET() {
  try {
    const payload = await getLiveStationsCached();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (err) {
    console.error("[weather/stations]", err);
    return NextResponse.json(
      { error: "Weather stations unavailable" },
      { status: 502 },
    );
  }
}
