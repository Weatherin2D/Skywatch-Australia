import { NextResponse } from "next/server";
import { getMeteyeThunderstormOutlook } from "@/lib/weather/bom-meteye-thunderstorm";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * GET /api/forecast
 * Live Day 1–3 convective risk from the official BoM MetEye thunderstorm layer.
 */
export async function GET() {
  try {
    const outlook = await getMeteyeThunderstormOutlook();
    return NextResponse.json(outlook, {
      headers: {
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("[forecast]", error);
    return NextResponse.json(
      { error: "Failed to load BoM risk outlook" },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
