import { NextRequest, NextResponse } from "next/server";
import { fetchEnsembleSpaghetti } from "@/lib/weather/ensemble-spaghetti";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/weather/ensemble?lat=&lon=&place=&var=temperature_2m|precipitation
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
    const variable =
      url.searchParams.get("var") || url.searchParams.get("variable");
    const days = Number(url.searchParams.get("days"));
    const payload = await fetchEnsembleSpaghetti({
      latitude: lat,
      longitude: lon,
      placeLabel: url.searchParams.get("place") ?? undefined,
      variable,
      forecastDays: Number.isFinite(days) ? days : undefined,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Ensemble unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
