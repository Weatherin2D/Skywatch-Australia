import { NextRequest, NextResponse } from "next/server";
import { getMeteyeThunderstormDayPng } from "@/lib/weather/bom-meteye-thunderstorm";
import { isBomThunderstormDay } from "@/lib/weather/bom-thunderstorm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W3ZoAAAAASUVORK5CYII=",
  "base64",
);

/**
 * GET /api/weather/risk-image?day=1|2|3
 * Official BoM MetEye IDZ73094 daily-max thunderstorm PNG for Leaflet ImageOverlay.
 */
export async function GET(req: NextRequest) {
  try {
    const dayNum = Number(req.nextUrl.searchParams.get("day") || "1");
    if (!isBomThunderstormDay(dayNum)) {
      return NextResponse.json({ error: "day must be 1, 2, or 3" }, { status: 400 });
    }

    const result = await getMeteyeThunderstormDayPng(dayNum);
    const png = !result || result.empty ? EMPTY_PNG : result.png;

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
        ...(result?.issuedAt
          ? { "X-BoM-Issued-At": result.issuedAt }
          : {}),
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
