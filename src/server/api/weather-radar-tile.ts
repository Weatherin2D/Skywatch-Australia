import { NextRequest, NextResponse } from "next/server";
import {
  RADAR_NATIVE_MAX_ZOOM,
  RADAR_PALETTE_ID,
  RADAR_RENDER_REV,
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

export const dynamic = "force-dynamic";

const HOST_RE = /^https:\/\/([a-z0-9.-]+\.)?rainviewer\.com$/i;
const PATH_RE = /^\/v2\/radar\/[a-z0-9]+$/i;

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

/**
 * Proxy RainViewer radar tiles remapped to the locked CloudCountry dBZ scale.
 *
 * GET /api/weather/radar-tile?host=&path=&pal=&r=&smooth=&z=&x=&y=
 *
 * `smooth=1` fetches RainViewer spatially-smoothed Universal Blue (`1_0`);
 * default `smooth=0` is crisp unsmoothed (`0_0`).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const host = sp.get("host") ?? "";
  const path = sp.get("path") ?? "";
  const z = sp.get("z");
  const x = sp.get("x");
  const y = sp.get("y");
  // Always fetch RainViewer unsmoothed (`0_0`). Spatially smoothed `1_0`
  // tiles blend palette colours and our dBZ recolour punches them transparent.
  const smooth = false;
  void sp.get("smooth");
  // Reject mismatched palette/rev so stale clients cannot poison the cache
  // with an older colour ladder under a shared process key.
  const pal = sp.get("pal") ?? "";
  const rev = sp.get("r") ?? "";
  if (
    (pal && pal !== RADAR_PALETTE_ID) ||
    (rev && rev !== RADAR_RENDER_REV)
  ) {
    return NextResponse.json(
      { error: "Stale radar palette — refresh the page" },
      { status: 409 },
    );
  }

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
    zi > 22 ||
    xi < 0 ||
    yi < 0
  ) {
    return NextResponse.json({ error: "Invalid tile coords" }, { status: 400 });
  }

  const overzoom = zi > RADAR_NATIVE_MAX_ZOOM;
  const scale = overzoom ? 2 ** (zi - RADAR_NATIVE_MAX_ZOOM) : 1;
  const fetchZ = overzoom ? RADAR_NATIVE_MAX_ZOOM : zi;
  const fetchX = overzoom ? Math.floor(xi / scale) : xi;
  const fetchY = overzoom ? Math.floor(yi / scale) : yi;

  const cacheKey = radarTileCacheKey(host, path, zi, xi, yi, smooth);
  const cached = getCachedRadarTile(cacheKey);
  if (cached) {
    return pngResponse(cached, {
      "X-Radar-Cache": "HIT",
      "X-Radar-Source": "rainviewer-raw",
      "X-Radar-Palette": RADAR_PALETTE_ID,
      "X-Radar-Rev": RADAR_RENDER_REV,
      "X-Radar-Smooth": smooth ? "1" : "0",
      "X-Radar-Tile-Size": "256",
      "X-Radar-Native-Z": String(fetchZ),
    });
  }

  const parentKey = radarTileCacheKey(
    host,
    path,
    fetchZ,
    fetchX,
    fetchY,
    smooth,
  );
  let parentRecoloured = getCachedRadarTile(parentKey);

  if (!parentRecoloured) {
    const upstream = rainviewerRawTileUrl(
      host,
      path,
      fetchZ,
      fetchX,
      fetchY,
      undefined,
      smooth,
    );
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
          "X-Radar-Palette": RADAR_PALETTE_ID,
          "X-Radar-Rev": RADAR_RENDER_REV,
          "X-Radar-Smooth": smooth ? "1" : "0",
          "X-Radar-Tile-Size": "256",
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
    "X-Radar-Palette": RADAR_PALETTE_ID,
    "X-Radar-Rev": RADAR_RENDER_REV,
    "X-Radar-Smooth": smooth ? "1" : "0",
    "X-Radar-Tile-Size": "256",
    "X-Radar-Native-Z": String(fetchZ),
    "X-Radar-Overzoom": overzoom ? String(scale) : "1",
  });
}
