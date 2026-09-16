import { NextRequest, NextResponse } from "next/server";
import {
  bomSynopticUpstreamUrl,
  isValidSynopticStamp,
} from "@/lib/weather/synoptic";

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

/** In-memory PNG cache keyed by stamp (process-local). */
const cache = new Map<
  string,
  { body: Buffer; contentType: string; cachedAt: number }
>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 24;

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

  const hit = cache.get(stamp);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) {
    return new NextResponse(new Uint8Array(hit.body), {
      status: 200,
      headers: {
        "Content-Type": hit.contentType,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=3600",
        "X-Synoptic-Cache": "HIT",
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

    const contentType = upstream.headers.get("content-type") ?? "image/png";
    const ab = await upstream.arrayBuffer();
    const body = Buffer.from(ab);
    if (body.length < 500 || body[0] !== 0x89) {
      return NextResponse.json({ error: "Empty chart" }, { status: 502 });
    }

    cache.set(stamp, { body, contentType, cachedAt: Date.now() });
    pruneCache();

    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=3600",
        "X-Synoptic-Cache": "MISS",
        "Content-Length": String(body.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "Synoptic fetch failed" }, { status: 502 });
  }
}
