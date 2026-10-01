import { NextRequest, NextResponse } from "next/server";
import {
  STATE_CAPITALS,
  fetchLocationForecast,
  isValidGeohash,
} from "@/lib/weather/location-forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    // /api/weather/forecast/:geohash  OR  ?geohash=  OR  ?region=nsw
    const pathHash =
      parts[0] === "api" &&
      parts[1] === "weather" &&
      parts[2] === "forecast" &&
      parts[3]
        ? parts[3]
        : null;

    const region = (url.searchParams.get("region") || "").toLowerCase();
    const geohash =
      pathHash ||
      url.searchParams.get("geohash") ||
      STATE_CAPITALS[region]?.geohash ||
      "";

    if (!geohash || !isValidGeohash(geohash)) {
      return NextResponse.json(
        { error: "Provide a valid location geohash or region" },
        { status: 400 },
      );
    }

    const forecast = await fetchLocationForecast(geohash);
    if (!forecast) {
      return NextResponse.json(
        { error: "Forecast unavailable for this location" },
        { status: 404 },
      );
    }

    return NextResponse.json(forecast, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Forecast unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
