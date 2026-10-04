import { NextResponse } from "next/server";
import { fetchUpperAir } from "@/lib/weather/upper-air";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/** Home upper-air panel — always the latest observed Sydney Airport sounding. */
export async function GET() {
  try {
    const payload = await fetchUpperAir();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control":
          payload.status === "ok"
            ? "public, s-maxage=300, stale-while-revalidate=1800"
            : "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Upper air unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
