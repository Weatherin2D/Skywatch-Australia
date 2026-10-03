import { NextRequest, NextResponse } from "next/server";
import { ensureArchiveSatFrame } from "@/lib/weather/archive-sat";
import {
  isSatelliteProductId,
  type SatelliteProductId,
} from "@/lib/weather/maps";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/weather/archive/frame?product=&time=
 * Serves stored JPEG; captures on demand when inside the archive epoch.
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
    const got = await ensureArchiveSatFrame(product, Math.floor(time));
    if (!got) {
      return NextResponse.json(
        { error: "Not archived yet" },
        { status: 404 },
      );
    }
    return new NextResponse(new Uint8Array(got.body), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": got.captured
          ? "public, max-age=300"
          : "public, max-age=86400, immutable",
        "X-Archive-Capture": got.captured ? "1" : "0",
      },
    });
  } catch (err) {
    console.error("[weather/archive/frame]", err);
    return NextResponse.json({ error: "Frame unavailable" }, { status: 500 });
  }
}
