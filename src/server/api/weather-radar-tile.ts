import { NextRequest, NextResponse } from "next/server";
import {
  rainviewerRawTileUrl,
  recolourRadarPng,
} from "@/lib/weather/radar-palette";

export const dynamic = "force-dynamic";

const HOST_RE = /^https:\/\/([a-z0-9.-]+\.)?rainviewer\.com$/i;
const PATH_RE = /^\/v2\/radar\/[a-z0-9]+$/i;

/**
 * Proxy RainViewer radar tiles as unsmoothed pixels, remapped to the
 * SkyWatch dBZ colour scale.
 *
 * GET /api/weather/radar-tile?host=&path=&z=&x=&y=
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const host = sp.get("host") ?? "";
  const path = sp.get("path") ?? "";
  const z = sp.get("z");
  const x = sp.get("x");
  const y = sp.get("y");

  if (!HOST_RE.test(host) || !PATH_RE.test(path)) {
    return NextResponse.json({ error: "Invalid host or path" }, { status: 400 });
  }
  if (z == null || x == null || y == null) {
    return NextResponse.json({ error: "Missing z/x/y" }, { status: 400 });
  }
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  if (
    !Number.isInteger(zi) ||
    !Number.isInteger(xi) ||
    !Number.isInteger(yi) ||
    zi < 0 ||
    zi > 12 ||
    xi < 0 ||
    yi < 0
  ) {
    return NextResponse.json({ error: "Invalid tile coords" }, { status: 400 });
  }

  const upstream = rainviewerRawTileUrl(host, path, zi, xi, yi);
  try {
    const res = await fetch(upstream, {
      headers: { Accept: "image/png" },
      next: { revalidate: 120 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream ${res.status}` },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const out = recolourRadarPng(buf);
    return new NextResponse(new Uint8Array(out), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120, stale-while-revalidate=300",
        "X-Radar-Source": "rainviewer-raw",
        "X-Radar-Palette": "skywatch-dbz",
      },
    });
  } catch (err) {
    console.error("[weather/radar-tile]", err);
    return NextResponse.json({ error: "Radar tile unavailable" }, { status: 502 });
  }
}
