import { NextRequest, NextResponse } from "next/server";
import {
  findBomRadarSite,
  fetchSiteRadarPng,
  nearestBomRadarSites,
  type BomRadarSite,
} from "@/lib/weather/bom-radar-sites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function parseRange(raw: string | null, site: BomRadarSite): BomRadarSite["defaultRange"] {
  if (raw === "1" || raw === "2" || raw === "3" || raw === "4") return raw;
  return site.defaultRange;
}

/**
 * GET /api/weather/bom-site-radar?lat=&lon=&limit=2
 *   → JSON list of nearest site frames (PNG urls + bounds)
 * GET /api/weather/bom-site-radar?code=70&range=4&format=png
 *   → processed site PNG
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") ?? "json").toLowerCase();
  const code = sp.get("code");

  try {
    if (code) {
      const site = findBomRadarSite(code);
      if (!site) {
        return NextResponse.json({ error: "Unknown radar site" }, { status: 404 });
      }
      const range = parseRange(sp.get("range"), site);
      const { png, bounds, productId } = await fetchSiteRadarPng(site, range);
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
          imageUrl: `/api/weather/bom-site-radar?code=${site.code}&range=${range}&format=png`,
          bounds,
          generated: Math.floor(Date.now() / 1000),
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=45, stale-while-revalidate=120",
          },
        },
      );
    }

    const lat = Number(sp.get("lat"));
    const lon = Number(sp.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
    }
    const limit = Math.min(3, Math.max(1, Number(sp.get("limit") ?? 2) || 2));
    const sites = nearestBomRadarSites(lat, lon, limit);
    const frames = await Promise.all(
      sites.map(async (site) => {
        const range = site.defaultRange;
        try {
          const { bounds, productId } = await fetchSiteRadarPng(site, range);
          return {
            code: site.code,
            name: site.name,
            productId,
            imageUrl: `/api/weather/bom-site-radar?code=${encodeURIComponent(site.code)}&range=${range}&format=png&t=${Math.floor(Date.now() / 60_000)}`,
            bounds,
            generated: Math.floor(Date.now() / 1000),
          };
        } catch (err) {
          console.error("[bom-site-radar]", site.code, err);
          return null;
        }
      }),
    );

    return NextResponse.json(
      {
        sites: frames.filter(Boolean),
        attribution:
          "Site radar © Commonwealth of Australia (Bureau of Meteorology)",
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
