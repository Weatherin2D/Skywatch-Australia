import { NextResponse } from "next/server";
import { fetchCyclonePayload } from "@/lib/weather/cyclones";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await fetchCyclonePayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cyclone data unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
