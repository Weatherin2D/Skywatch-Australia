import { NextRequest, NextResponse } from "next/server";
import { isSatelliteProductId } from "@/lib/weather/maps";
import { getCachedFrame } from "@/lib/weather/frame-cache";
import { fetchAndCacheFrameResilient } from "@/lib/weather/fetch-frame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Same-origin proxy for Himawari WMS frames.
 * Browser playback hits this URL so frames cache locally and avoid NASA connection limits.
 */
export async function GET(request: NextRequest) {
  const productRaw = request.nextUrl.searchParams.get("product") ?? "";
  const timeRaw = request.nextUrl.searchParams.get("time") ?? "";
  const timeUnix = Number(timeRaw);

  if (
    !isSatelliteProductId(productRaw) ||
    !Number.isFinite(timeUnix) ||
    timeUnix <= 0
  ) {
    return NextResponse.json({ error: "Invalid frame request" }, { status: 400 });
  }

  const cached = getCachedFrame(productRaw, timeUnix);
  if (cached) {
    return new NextResponse(new Uint8Array(cached.body), {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Frame-Cache": "HIT",
        "Content-Length": String(cached.body.length),
      },
    });
  }

  const frame = await fetchAndCacheFrameResilient(productRaw, timeUnix);
  if (!frame) {
    return NextResponse.json({ error: "Frame not ready" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(frame.body), {
    status: 200,
    headers: {
      "Content-Type": frame.contentType,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Frame-Cache":
        frame.resolvedTime === timeUnix ? "MISS" : "NEAR-MISS",
      "X-Frame-Resolved-Time": String(frame.resolvedTime),
      "Content-Length": String(frame.body.length),
    },
  });
}
