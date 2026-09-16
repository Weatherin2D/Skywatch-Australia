import { NextRequest, NextResponse } from "next/server";
import {
  bomSynopticUpstreamUrl,
  isValidSynopticStamp,
} from "@/lib/weather/synoptic";
import { warpSynopticToGibsMercator } from "@/lib/weather/synoptic-warp";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const BOM_FETCH_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  Referer: "https://www.bom.gov.au/australia/charts/synoptic_col.shtml",
};

/** In-memory warped PNG cache keyed by stamp (process-local). */
const cache = new Map<
  string,
  { body: Buffer; contentType: string; cachedAt: number }
>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 16;
/** Bump when synoptic-fit.json / warp math changes so stale frames are dropped. */
const WARP_CACHE_EPOCH = "polar-gcp-v4";

function pruneCache() {
  if (cache.size <= CACHE_MAX) return;
  const entries = [...cache.entries()].sort(
    (a, b) => a[1].cachedAt - b[1].cachedAt,
  );
  const drop = entries.length - CACHE_MAX;
  for (let i = 0; i < drop; i++) {
    cache.delete(entries[i]![0]);
  }
}

export async function GET(request: NextRequest) {
  const stamp = request.nextUrl.searchParams.get("time") ?? "";
  if (!isValidSynopticStamp(stamp)) {
    return NextResponse.json({ error: "Invalid synoptic time" }, { status: 400 });
  }

  const cacheKey = `${WARP_CACHE_EPOCH}:${stamp}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) {
    return new NextResponse(new Uint8Array(hit.body), {
      status: 200,
      headers: {
        "Content-Type": hit.contentType,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=3600",
        "X-Synoptic-Cache": "HIT",
        "X-Synoptic-Warp": WARP_CACHE_EPOCH,
        "Content-Length": String(hit.body.length),
      },
    });
  }

  try {
    const upstream = await fetch(bomSynopticUpstreamUrl(stamp), {
      headers: BOM_FETCH_HEADERS,
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
        { status: upstream.status === 404 ? 404 : 502 },
      );
    }

    const ab = await upstream.arrayBuffer();
    const raw = Buffer.from(ab);
    if (raw.length < 500 || raw[0] !== 0x89) {
      return NextResponse.json({ error: "Empty chart" }, { status: 502 });
    }

    const body = warpSynopticToGibsMercator(raw);
    const contentType = "image/png";
    cache.set(cacheKey, { body, contentType, cachedAt: Date.now() });
    pruneCache();

    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=3600",
        "X-Synoptic-Cache": "MISS",
        "X-Synoptic-Warp": WARP_CACHE_EPOCH,
        "Content-Length": String(body.length),
      },
    });
  } catch (err) {
    console.error("synoptic frame failed", err);
    return NextResponse.json({ error: "Synoptic fetch failed" }, { status: 502 });
  }
}
