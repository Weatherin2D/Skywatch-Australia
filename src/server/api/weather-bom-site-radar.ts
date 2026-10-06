import { NextRequest, NextResponse } from "next/server";
import {
  findBomRadarSite,
  fetchSiteRadarPng,
  parseRadarRangeKm,
  rangeCodeToKm,
  type BomRadarRangeKm,
  type BomRadarSite,
} from "@/lib/weather/bom-radar-sites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function parseRange(
  raw: string | null,
  site: BomRadarSite,
): BomRadarRangeKm {
  return parseRadarRangeKm(raw) ?? rangeCodeToKm(site.defaultRange);
}

/**
 * GET /api/weather/bom-site-radar?code=71&range=64&format=png
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") ?? "json").toLowerCase();

  try {
    const code = sp.get("code");
    if (!code) {
      return NextResponse.json({ error: "code required" }, { status: 400 });
    }

    const site = findBomRadarSite(code);
    if (!site) {
      return NextResponse.json({ error: "Unknown radar site" }, { status: 404 });
    }
    const rangeKm = parseRange(sp.get("range"), site);
    const { png, bounds, productId } = await fetchSiteRadarPng(site, rangeKm);

    if (format === "png") {
      return new NextResponse(new Uint8Array(png), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=45, stale-while-revalidate=120",
          "X-Bom-Radar-Product": productId,
          "X-Bom-Radar-Bounds": JSON.stringify(bounds),
        },
      });
    }

    return NextResponse.json(
      {
        code: site.code,
        name: site.name,
        productId,
        rangeKm,
        imageUrl: `/api/weather/bom-site-radar?code=${encodeURIComponent(site.code)}&range=${rangeKm}&format=png&t=${Math.floor(Date.now() / 60_000)}`,
        bounds,
        generated: Math.floor(Date.now() / 1000),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=45, stale-while-revalidate=120",
        },
      },
    );
  } catch (err) {
    console.error("[weather/bom-site-radar]", err);
    return NextResponse.json(
      { error: "Site radar unavailable" },
      { status: 502 },
    );
  }
}
