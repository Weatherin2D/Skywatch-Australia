import { NextResponse } from "next/server";
import { fetchStormActivity } from "@/lib/weather/storm-activity";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await fetchStormActivity();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=45, stale-while-revalidate=90",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Storm activity unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
