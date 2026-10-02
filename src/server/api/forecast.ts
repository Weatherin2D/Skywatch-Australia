import { NextResponse } from "next/server";
import { getBomRiskOutlook } from "@/lib/weather/bom-risk-outlook";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * GET /api/forecast
 * Live Day 1–3 convective risk from BoM forecasts + severe thunderstorm warnings.
 */
export async function GET() {
  try {
    const outlook = await getBomRiskOutlook();
    const meta = (
      outlook as PublicForecastLike
    ).meta;
    const coverage =
      meta && meta.sitesTotal > 0 ? meta.sitesOk / meta.sitesTotal : 1;
    // Avoid CDN-caching a thinly sampled response after upstream rate limits.
    const cache =
      coverage >= 0.7
        ? "public, max-age=60, stale-while-revalidate=300"
        : "public, max-age=15, stale-while-revalidate=30";
    return NextResponse.json(outlook, {
      headers: { "Cache-Control": cache },
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

type PublicForecastLike = {
  meta?: { sitesOk: number; sitesTotal: number };
};
