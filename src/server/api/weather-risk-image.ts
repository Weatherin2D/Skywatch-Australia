import { NextRequest, NextResponse } from "next/server";
import { getMeteyeThunderstormDayPng } from "@/lib/weather/bom-meteye-thunderstorm";
import { getOfficialThunderstormChart } from "@/lib/weather/bom-thunderstorm-charts";
import { isBomThunderstormDay } from "@/lib/weather/bom-thunderstorm";
import type { MapRegionId } from "@/components/home/mock-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W3ZoAAAAASUVORK5CYII=",
  "base64",
);

const STATE_REGIONS = new Set<MapRegionId>([
  "nsw",
  "vic",
  "qld",
  "wa",
  "sa",
  "tas",
  "nt",
]);

/**
 * GET /api/weather/risk-image?day=1|2|3&region=national|vic|...
 *
 * - State regions: official BoM Thunderstorm Forecast sheet when published
 * - Otherwise: MetEye IDZ73094 daily-max geo PNG
 */
export async function GET(req: NextRequest) {
  try {
    const dayNum = Number(req.nextUrl.searchParams.get("day") || "1");
    if (!isBomThunderstormDay(dayNum)) {
      return NextResponse.json({ error: "day must be 1, 2, or 3" }, { status: 400 });
    }

    const regionParam = (req.nextUrl.searchParams.get("region") ||
      "national") as MapRegionId;

    if (STATE_REGIONS.has(regionParam) && dayNum <= 2) {
      const chart = await getOfficialThunderstormChart(regionParam, dayNum);
      if (chart) {
        return new NextResponse(new Uint8Array(chart.png), {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
            "X-BoM-Product": chart.productId,
            "X-Risk-Display": "sheet",
            ...(chart.issuedText
              ? { "X-BoM-Issued-Text": chart.issuedText }
              : {}),
          },
        });
      }
    }

    const result = await getMeteyeThunderstormDayPng(dayNum);
    const png = !result || result.empty ? EMPTY_PNG : result.png;

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
        "X-Risk-Display": "geo",
        "X-BoM-Product": "IDZ73094",
        ...(result?.issuedAt ? { "X-BoM-Issued-At": result.issuedAt } : {}),
      },
    });
  } catch (err) {
    console.error("[weather/risk-image]", err);
    return NextResponse.json(
      { error: "Risk image unavailable" },
      { status: 502 },
    );
  }
}
