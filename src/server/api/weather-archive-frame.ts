import { NextRequest, NextResponse } from "next/server";
import { ensureArchiveSatFrame } from "@/lib/weather/archive-sat";
import { fetchAndCacheFrameResilient } from "@/lib/weather/fetch-frame";
import { GIBS_AU_BOUNDS } from "@/lib/weather/maps";
import {
  isSatelliteProductId,
  type SatelliteProductId,
} from "@/lib/weather/maps";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

async function liveJpeg(
  product: SatelliteProductId,
  time: number,
): Promise<Buffer | null> {
  try {
    const got = await fetchAndCacheFrameResilient(
      product,
      time,
      GIBS_AU_BOUNDS,
      "national",
    );
    if (!got) return null;
    return sharp(got.body)
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * GET /api/weather/archive/frame?product=&time=
 * Serves stored JPEG; captures on demand; falls back to live proxy encode.
 */
export async function GET(request: NextRequest) {
  const productRaw = request.nextUrl.searchParams.get("product") ?? "";
  const timeRaw = request.nextUrl.searchParams.get("time") ?? "";
  const time = Number(timeRaw);
  if (!isSatelliteProductId(productRaw) || !Number.isFinite(time)) {
    return NextResponse.json({ error: "Invalid product or time" }, { status: 400 });
  }
  const product = productRaw as SatelliteProductId;
  const stamp = Math.floor(time);
  try {
    const got = await ensureArchiveSatFrame(product, stamp);
    if (got) {
      return new NextResponse(new Uint8Array(got.body), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": got.captured
            ? "public, max-age=300"
            : "public, max-age=86400, immutable",
          "X-Archive-Capture": got.captured ? "1" : "0",
        },
      });
    }

    const fallback = await liveJpeg(product, stamp);
    if (fallback) {
      return new NextResponse(new Uint8Array(fallback), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=120",
          "X-Archive-Capture": "live-fallback",
        },
      });
    }

    return NextResponse.json(
      { error: "Not archived yet" },
      { status: 404 },
    );
  } catch (err) {
    console.error("[weather/archive/frame]", err);
    return NextResponse.json({ error: "Frame unavailable" }, { status: 500 });
  }
}
