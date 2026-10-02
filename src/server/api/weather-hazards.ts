import { NextRequest, NextResponse } from "next/server";
import { fetchHazards } from "@/lib/weather/hazards";
import { STATE_CAPITALS } from "@/lib/weather/location-forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const geohash =
      url.searchParams.get("geohash") || STATE_CAPITALS.nsw.geohash;
    const latParam = url.searchParams.get("lat");
    const lonParam = url.searchParams.get("lon");
    const latitude = latParam != null ? Number(latParam) : undefined;
    const longitude = lonParam != null ? Number(lonParam) : undefined;
    const payload = await fetchHazards({
      geohash,
      latitude:
        latitude != null && Number.isFinite(latitude) ? latitude : undefined,
      longitude:
        longitude != null && Number.isFinite(longitude) ? longitude : undefined,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Hazards unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
