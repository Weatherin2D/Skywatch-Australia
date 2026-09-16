import { NextResponse } from "next/server";
import {
  SYNOPTIC_ATTRIBUTION,
  SYNOPTIC_PRODUCT,
  bomSynopticUpstreamUrl,
  buildSynopticFrame,
  listSynopticCandidateStamps,
  type SynopticFrame,
  type SynopticPayload,
} from "@/lib/weather/synoptic";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** BoM blocks bare Node fetch; use a browser-like client profile. */
const BOM_FETCH_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  Referer: "https://www.bom.gov.au/australia/charts/synoptic_col.shtml",
};

async function stampExists(stamp: string): Promise<boolean> {
  try {
    const res = await fetch(bomSynopticUpstreamUrl(stamp), {
      method: "GET",
      headers: {
        ...BOM_FETCH_HEADERS,
        Range: "bytes=0-128",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * Build catalog from recent 6-hourly stamps.
 * Prefer probed hits; if probing fails (egress/WAF), fall back to the
 * newest candidate stamps so the client can still attempt image loads.
 */
async function resolveAvailableFrames(): Promise<SynopticFrame[]> {
  const candidates = listSynopticCandidateStamps(undefined, 7);
  const found: SynopticFrame[] = [];
  const concurrency = 4;
  let i = 0;
  let probedOk = 0;
  while (i < candidates.length && found.length < 12) {
    const batch = candidates.slice(i, i + concurrency);
    i += concurrency;
    const results = await Promise.all(
      batch.map(async (stamp) => ({ stamp, ok: await stampExists(stamp) })),
    );
    for (const { stamp, ok } of results) {
      if (!ok) continue;
      probedOk += 1;
      const frame = buildSynopticFrame(stamp);
      if (frame) found.push(frame);
    }
  }

  if (found.length === 0) {
    for (const stamp of candidates.slice(0, 8)) {
      const frame = buildSynopticFrame(stamp);
      if (frame) found.push(frame);
    }
  }

  found.sort((a, b) => b.time - a.time);
  return found;
}

export async function GET() {
  const frames = await resolveAvailableFrames();
  const payload: SynopticPayload = {
    generated: Math.floor(Date.now() / 1000),
    product: SYNOPTIC_PRODUCT,
    frames,
    latest: frames[0] ?? null,
    attribution: SYNOPTIC_ATTRIBUTION,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    },
  });
}
