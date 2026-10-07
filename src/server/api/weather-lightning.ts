import { NextResponse } from "next/server";
import { getLiveLightningSnapshot } from "@/lib/weather/blitzortung-feed";
import {
  LIGHTNING_API_MAX_STRIKES,
  sampleStrikesAcrossTime,
  type LightningPayload,
} from "@/lib/weather/lightning";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
/** Allow LightningMaps PNG backfill on cold start. */
export const maxDuration = 15;

export async function GET() {
  const snap = await getLiveLightningSnapshot();
  // Never ship the raw 40k buffer — sample across time buckets (and lon bands
  // inside each) so the IR loop keeps a trail without freezing phones.
  const strikes = sampleStrikesAcrossTime(
    snap.strikes,
    LIGHTNING_API_MAX_STRIKES,
  );
  const payload: LightningPayload = {
    generated: snap.generated,
    source: snap.source,
    status: snap.status,
    windowMinutes: snap.windowMinutes,
    strikes,
    attribution: snap.attribution,
    receivedTotal: snap.receivedTotal,
    receivedInBounds: snap.receivedInBounds,
  };

  // Never CDN-cache an empty buffer — that stranded clients on "connecting".
  const cacheControl =
    strikes.length === 0
      ? "no-store"
      : "public, s-maxage=15, stale-while-revalidate=30, max-age=8";

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": cacheControl,
      "X-Lightning-In-Bounds": String(snap.receivedInBounds),
      "X-Lightning-Buffered": String(snap.strikes.length),
      "X-Lightning-Returned": String(strikes.length),
      "X-Lightning-Status": snap.status,
    },
  });
}
