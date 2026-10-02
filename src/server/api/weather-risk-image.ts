import { NextRequest, NextResponse } from "next/server";
import { isBomThunderstormDay } from "@/lib/weather/bom-thunderstorm";
import {
  ensureSeedBomRiskManifest,
  readBomRiskImage,
} from "@/lib/weather/bom-thunderstorm-storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/weather/risk-image?day=1|2|3
 */
export async function GET(req: NextRequest) {
  const dayNum = Number(req.nextUrl.searchParams.get("day"));
  if (!isBomThunderstormDay(dayNum)) {
    return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  }
  try {
    await ensureSeedBomRiskManifest();
    const hit = await readBomRiskImage(dayNum);
    if (!hit) {
      return NextResponse.json({ error: "No chart for this day" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(hit.body), {
      status: 200,
      headers: {
        "Content-Type": hit.contentType,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "X-Risk-Day": String(dayNum),
      },
    });
  } catch (err) {
    console.error("[weather/risk-image]", err);
    return NextResponse.json({ error: "Chart unavailable" }, { status: 502 });
  }
}
