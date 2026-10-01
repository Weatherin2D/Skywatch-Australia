import { NextResponse } from "next/server";
import { fetchCapitalSnapshots } from "@/lib/weather/location-forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  try {
    const capitals = await fetchCapitalSnapshots();
    return NextResponse.json(
      {
        generated: new Date().toISOString(),
        capitals,
        attribution: "Bureau of Meteorology",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Capital weather unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
