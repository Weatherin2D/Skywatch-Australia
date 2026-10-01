import { NextRequest, NextResponse } from "next/server";
import { fetchUpperAir } from "@/lib/weather/upper-air";
import { STATE_CAPITALS } from "@/lib/weather/location-forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const sydney = STATE_CAPITALS.nsw;
    const lat = Number(url.searchParams.get("lat") || -33.87);
    const lon = Number(url.searchParams.get("lon") || 151.21);
    const placeLabel =
      url.searchParams.get("place") || sydney.name || "Sydney";
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    }
    const payload = await fetchUpperAir({
      latitude: lat,
      longitude: lon,
      placeLabel,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Upper air unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
