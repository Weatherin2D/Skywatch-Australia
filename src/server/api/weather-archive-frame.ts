import { NextRequest, NextResponse } from "next/server";
import { getSatFrame } from "@/lib/weather/archive-storage";
import {
  isSatelliteProductId,
  type SatelliteProductId,
} from "@/lib/weather/maps";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/weather/archive/frame?product=&time=
 */
export async function GET(request: NextRequest) {
  const productRaw = request.nextUrl.searchParams.get("product") ?? "";
  const timeRaw = request.nextUrl.searchParams.get("time") ?? "";
  const time = Number(timeRaw);
  if (!isSatelliteProductId(productRaw) || !Number.isFinite(time)) {
    return NextResponse.json({ error: "Invalid product or time" }, { status: 400 });
  }
  const product = productRaw as SatelliteProductId;
  try {
    const body = await getSatFrame(product, Math.floor(time));
    if (!body) {
      return NextResponse.json(
        { error: "Not archived yet" },
        { status: 404 },
      );
    }
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    console.error("[weather/archive/frame]", err);
    return NextResponse.json({ error: "Frame unavailable" }, { status: 500 });
  }
}
