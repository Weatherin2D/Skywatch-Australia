import { NextRequest, NextResponse } from "next/server";
import { searchBomLocations } from "@/lib/weather/location-forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams.get("q")?.trim() || "";
    if (q.length < 2) {
      return NextResponse.json(
        { query: q, locations: [], attribution: "Bureau of Meteorology" },
        {
          headers: {
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          },
        },
      );
    }
    const locations = await searchBomLocations(q, 10);
    return NextResponse.json(
      {
        query: q,
        locations,
        attribution: "Bureau of Meteorology",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Location search unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
