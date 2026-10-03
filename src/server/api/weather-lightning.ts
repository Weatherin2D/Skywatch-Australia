import { NextResponse } from "next/server";
import { getLiveLightningSnapshot } from "@/lib/weather/blitzortung-feed";
import type { LightningPayload } from "@/lib/weather/lightning";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
/** Allow LightningMaps PNG backfill on cold start. */
export const maxDuration = 30;

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

  // Never CDN-cache an empty buffer — that stranded clients on "connecting".
  const cacheControl =
    snap.strikes.length === 0
      ? "no-store"
      : "public, s-maxage=15, stale-while-revalidate=30, max-age=8";

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": cacheControl,
      "X-Lightning-In-Bounds": String(snap.receivedInBounds),
      "X-Lightning-Buffered": String(snap.strikes.length),
      "X-Lightning-Status": snap.status,
    },
  });
}
