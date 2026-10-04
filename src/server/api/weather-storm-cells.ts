import { NextResponse } from "next/server";
import { fetchStormCells } from "@/lib/weather/storm-cells";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/weather/storm-cells */
export async function GET() {
  try {
    const payload = await fetchStormCells();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Storm cells unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
