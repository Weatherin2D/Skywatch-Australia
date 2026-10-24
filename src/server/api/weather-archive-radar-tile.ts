import { NextRequest, NextResponse } from "next/server";
import {
  getRadarFrame,
  putRadarFrame,
  radarFrameExists,
} from "@/lib/weather/archive-storage";
import { quantizeArchiveStamp } from "@/lib/weather/archive-time";
import { rainviewerRawTileUrl } from "@/lib/weather/radar-palette";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/weather/archive/radar-tile?path=&z=&x=&y=
 * Serves archived RainViewer radar tiles; on miss fetches live and caches.
 */
export async function GET(request: NextRequest) {
  const pathRaw = request.nextUrl.searchParams.get("path") ?? "";
  const zRaw = request.nextUrl.searchParams.get("z") ?? "";
  const xRaw = request.nextUrl.searchParams.get("x") ?? "";
  const yRaw = request.nextUrl.searchParams.get("y") ?? "";

  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);

  if (!pathRaw || !Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "Invalid radar tile request" }, { status: 400 });
  }
  if (z < 0 || z > 12 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400 });
  }

  const stamp = quantizeArchiveStamp(Math.floor(Date.now() / 1000));

  try {
    // 1) Try archive storage first.
    const cached = await getRadarFrame(pathRaw, z, x, y);
    if (cached) {
      return new NextResponse(new Uint8Array(cached), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400, immutable",
          "X-Archive-Radar": "1",
        },
      });
    }

    // 2) Not archived — fetch live from RainViewer and cache in background.
    const host = "https://tilecache.rainviewer.com";
    const url = rainviewerRawTileUrl(host, pathRaw, z, x, y, 256, false);
    const res = await fetch(url, {
      headers: { Accept: "image/png" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Radar tile unavailable" }, { status: 404 });
    }
    const buf = Buffer.from(await res.arrayBuffer());

    // Persist so future requests hit the archive path.
    void putRadarFrame(pathRaw, z, x, y, buf).catch((err) => {
      console.warn("[weather/archive/radar-tile] background persist", err);
    });

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        "X-Archive-Radar": "0",
      },
    });
  } catch (err) {
    console.error("[weather/archive/radar-tile]", err);
    return NextResponse.json({ error: "Radar tile unavailable" }, { status: 500 });
  }
}