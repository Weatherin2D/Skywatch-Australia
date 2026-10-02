import { NextRequest, NextResponse } from "next/server";
import {
  getMeteyeThunderstormDayPng,
  isMeteyeOutlookDay,
} from "@/lib/weather/bom-meteye-thunderstorm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W3ZoAAAAASUVORK5CYII=",
  "base64",
);

/**
 * GET /api/weather/risk-image?day=1…N
 * Official BoM MetEye IDZ73094 PNG for Leaflet ImageOverlay.
 */
export async function GET(req: NextRequest) {
  try {
    const dayNum = Number(req.nextUrl.searchParams.get("day") || "1");
    if (!isMeteyeOutlookDay(dayNum)) {
      return NextResponse.json(
        { error: "day must be a MetEye outlook day (1–8)" },
        { status: 400 },
      );
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
