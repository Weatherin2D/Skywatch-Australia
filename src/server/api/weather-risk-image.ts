import { NextRequest, NextResponse } from "next/server";
import {
  getBomRiskDayPoints,
  getBomRiskOutlook,
} from "@/lib/weather/bom-risk-outlook";
import { renderBomRiskPng } from "@/lib/weather/bom-risk-smooth";
import { isBomThunderstormDay } from "@/lib/weather/bom-thunderstorm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/weather/risk-image?day=1|2|3
 * Smooth carved BoM-style risk band PNG for Leaflet ImageOverlay.
 */
export async function GET(req: NextRequest) {
  try {
    const dayNum = Number(req.nextUrl.searchParams.get("day") || "1");
    if (!isBomThunderstormDay(dayNum)) {
      return NextResponse.json({ error: "day must be 1, 2, or 3" }, { status: 400 });
    }

    // Ensure sample cache is warm (shared with /api/forecast).
    await getBomRiskOutlook();
    const points = getBomRiskDayPoints(dayNum);
    if (!points.length) {
      // Transparent 1×1 PNG
      const empty = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W3ZoAAAAASUVORK5CYII=",
        "base64",
      );
      return new NextResponse(empty, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    }

    const png = renderBomRiskPng(points);
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
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
