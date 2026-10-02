import { NextResponse } from "next/server";
import { getBomRiskOutlook } from "@/lib/weather/bom-risk-outlook";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const headers = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

/**
 * GET /api/forecast
 * Live Day 1–3 convective risk from BoM forecasts + severe thunderstorm warnings.
 */
export async function GET() {
  try {
    const outlook = await getBomRiskOutlook();
    return NextResponse.json(outlook, { headers });
  } catch (error) {
    console.error("[forecast]", error);
    return NextResponse.json(
      { error: "Failed to load BoM risk outlook" },
      { status: 502, headers },
    );
  }
}
