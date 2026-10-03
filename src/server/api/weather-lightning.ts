import { NextResponse } from "next/server";
import { getLiveLightningSnapshot } from "@/lib/weather/blitzortung-feed";
import type { LightningPayload } from "@/lib/weather/lightning";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  const snap = await getLiveLightningSnapshot();
  const payload: LightningPayload = {
    generated: snap.generated,
    source: snap.source,
    status: snap.status,
    windowMinutes: snap.windowMinutes,
    strikes: snap.strikes,
    attribution: snap.attribution,
    receivedTotal: snap.receivedTotal,
    receivedInBounds: snap.receivedInBounds,
  };

  return NextResponse.json(payload, {
    headers: {
      // Short CDN/browser cache — clients poll slowly; live strikes also arrive
      // via the browser WebSocket feed.
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30, max-age=10",
      "X-Lightning-In-Bounds": String(snap.receivedInBounds),
      "X-Lightning-Buffered": String(snap.strikes.length),
    },
  });
}
