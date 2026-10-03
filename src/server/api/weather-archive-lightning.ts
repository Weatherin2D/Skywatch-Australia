import { NextRequest, NextResponse } from "next/server";
import { ensureArchiveMeta, getLightningRange } from "@/lib/weather/archive-storage";
import { LIGHTNING_VISIBLE_WINDOW_SEC } from "@/lib/weather/lightning";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/weather/archive/lightning?from=&to=
 */
export async function GET(request: NextRequest) {
  const fromRaw = request.nextUrl.searchParams.get("from");
  const toRaw = request.nextUrl.searchParams.get("to");
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return NextResponse.json({ error: "Invalid from/to" }, { status: 400 });
  }
  try {
    const meta = await ensureArchiveMeta();
    const lo = Math.max(meta.epochUnix, Math.floor(from));
    const hi = Math.floor(to);
    if (hi < meta.epochUnix) {
      return NextResponse.json({
        generated: Math.floor(Date.now() / 1000),
        source: "archive",
        strikes: [],
        attribution:
          "Lightning © Blitzortung.org / LightningMaps.org (CC BY-SA) — entertainment only",
        windowMinutes: Math.round(LIGHTNING_VISIBLE_WINDOW_SEC / 60),
      });
    }
    const strikes = await getLightningRange(lo, hi);
    return NextResponse.json(
      {
        generated: Math.floor(Date.now() / 1000),
        source: "archive",
        from: lo,
        to: hi,
        strikes,
        attribution:
          "Lightning © Blitzortung.org / LightningMaps.org (CC BY-SA) — entertainment only, not for official warning use",
        windowMinutes: Math.round(LIGHTNING_VISIBLE_WINDOW_SEC / 60),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    console.error("[weather/archive/lightning]", err);
    return NextResponse.json(
      { error: "Archive lightning unavailable" },
      { status: 500 },
    );
  }
}
