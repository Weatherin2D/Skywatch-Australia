import { NextRequest, NextResponse } from "next/server";
import {
  RADAR_NATIVE_MAX_ZOOM,
  extractOverzoomTile,
  isRainviewerPlaceholderPng,
  rainviewerRawTileUrl,
  recolourRadarPng,
  transparentRadarTilePng,
} from "@/lib/weather/radar-palette";
import {
  getCachedRadarTile,
  radarTileCacheKey,
  setCachedRadarTile,
} from "@/lib/weather/radar-tile-cache";
import { renderBomRadarXyzTile } from "@/lib/weather/bom-radar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const HOST_RE = /^https:\/\/([a-z0-9.-]+\.)?rainviewer\.com$/i;
const PATH_RE = /^\/v2\/radar\/[a-z0-9]+$/i;
const BOM_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function pngResponse(
  body: Buffer,
  headers: Record<string, string>,
): NextResponse {
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control":
        "public, max-age=1800, stale-while-revalidate=7200, immutable",
      ...headers,
    },
  });
}

function parseTileCoords(sp: URLSearchParams) {
  const z = sp.get("z");
  const x = sp.get("x");
  const y = sp.get("y");
  if (z == null || x == null || y == null) return null;
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  if (
    !Number.isInteger(zi) ||
    !Number.isInteger(xi) ||
    !Number.isInteger(yi) ||
    zi < 0 ||
    zi > 22 ||
    xi < 0 ||
    yi < 0
  ) {
    return null;
  }
  return { zi, xi, yi };
}

async function serveBomTile(
  time: string,
  zi: number,
  xi: number,
  yi: number,
): Promise<NextResponse> {
  const cacheKey = `bom-v1|${time}|${zi}/${xi}/${yi}`;
  const cached = getCachedRadarTile(cacheKey);
  if (cached) {
    return pngResponse(cached, {
      "X-Radar-Cache": "HIT",
      "X-Radar-Source": "bom-wmts",
      "X-Radar-Palette": "skywatch-dbz",
      "X-Radar-Native-Z": String(Math.min(zi, 8)),
    });
  }
  const out = await renderBomRadarXyzTile(time, zi, xi, yi);
  setCachedRadarTile(cacheKey, out);
  return pngResponse(out, {
    "X-Radar-Cache": "MISS",
    "X-Radar-Source": "bom-wmts",
    "X-Radar-Palette": "skywatch-dbz",
    "X-Radar-Native-Z": String(Math.min(zi, 8)),
    "X-Radar-Overzoom": zi > 8 ? String(2 ** (zi - 8)) : "1",
  });
}

/**
 * Proxy radar tiles:
 *  - source=bom&time=ISO — BoM WMTS reflectivity composited to Leaflet XYZ
 *  - host=&path= — RainViewer Universal Blue remapped to SkyWatch dBZ
 *
 * GET /api/weather/radar-tile?...&z=&x=&y=
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const coords = parseTileCoords(sp);
  if (!coords) {
    return NextResponse.json({ error: "Invalid tile coords" }, { status: 400 });
  }
  const { zi, xi, yi } = coords;

  const source = (sp.get("source") ?? "").toLowerCase();
  const bomTime = sp.get("time") ?? "";
  if (source === "bom" || (bomTime && BOM_TIME_RE.test(bomTime) && !sp.get("host"))) {
    if (!BOM_TIME_RE.test(bomTime)) {
      return NextResponse.json({ error: "Invalid BoM time" }, { status: 400 });
    }
    try {
      return await serveBomTile(bomTime, zi, xi, yi);
    } catch (err) {
      console.error("[weather/radar-tile bom]", err);
      return NextResponse.json(
        { error: "BoM radar tile unavailable" },
        { status: 502 },
      );
    }
  }

  const host = sp.get("host") ?? "";
  const path = sp.get("path") ?? "";

  if (!HOST_RE.test(host) || !PATH_RE.test(path)) {
    return NextResponse.json({ error: "Invalid host or path" }, { status: 400 });
  }

  const overzoom = zi > RADAR_NATIVE_MAX_ZOOM;
  const scale = overzoom ? 2 ** (zi - RADAR_NATIVE_MAX_ZOOM) : 1;
  const fetchZ = overzoom ? RADAR_NATIVE_MAX_ZOOM : zi;
  const fetchX = overzoom ? Math.floor(xi / scale) : xi;
  const fetchY = overzoom ? Math.floor(yi / scale) : yi;

  const cacheKey = radarTileCacheKey(host, path, zi, xi, yi);
  const cached = getCachedRadarTile(cacheKey);
  if (cached) {
    return pngResponse(cached, {
      "X-Radar-Cache": "HIT",
      "X-Radar-Source": "rainviewer-raw",
      "X-Radar-Palette": "skywatch-dbz",
      "X-Radar-Tile-Size": "512",
      "X-Radar-Smooth": "0",
      "X-Radar-Native-Z": String(fetchZ),
    });
  }

  const parentKey = radarTileCacheKey(host, path, fetchZ, fetchX, fetchY);
  let parentRecoloured = getCachedRadarTile(parentKey);

  if (!parentRecoloured) {
    const upstream = rainviewerRawTileUrl(host, path, fetchZ, fetchX, fetchY);
    try {
      const res = await fetch(upstream, {
        headers: { Accept: "image/png" },
        cache: "force-cache",
        next: { revalidate: 7200 },
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Upstream ${res.status}` },
          { status: res.status === 404 ? 404 : 502 },
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (isRainviewerPlaceholderPng(buf)) {
        const empty = transparentRadarTilePng();
        setCachedRadarTile(parentKey, empty);
        setCachedRadarTile(cacheKey, empty);
        return pngResponse(empty, {
          "X-Radar-Cache": "MISS",
          "X-Radar-Source": "rainviewer-placeholder",
          "X-Radar-Palette": "skywatch-dbz",
          "X-Radar-Native-Z": String(fetchZ),
        });
      }
      parentRecoloured = recolourRadarPng(buf);
      setCachedRadarTile(parentKey, parentRecoloured);
    } catch (err) {
      console.error("[weather/radar-tile]", err);
      return NextResponse.json(
        { error: "Radar tile unavailable" },
        { status: 502 },
      );
    }
  }

  const out = overzoom
    ? extractOverzoomTile(parentRecoloured, scale, xi, yi)
    : parentRecoloured;
  setCachedRadarTile(cacheKey, out);
  return pngResponse(out, {
    "X-Radar-Cache": "MISS",
    "X-Radar-Source": "rainviewer-raw",
    "X-Radar-Palette": "skywatch-dbz",
    "X-Radar-Tile-Size": "512",
    "X-Radar-Smooth": "0",
    "X-Radar-Native-Z": String(fetchZ),
    "X-Radar-Overzoom": overzoom ? String(scale) : "1",
  });
}
