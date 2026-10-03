import { NextRequest, NextResponse } from "next/server";
import {
  getSynopticRecord,
  putSynopticRecord,
  type ArchiveSynopticRecord,
} from "@/lib/weather/archive-storage";
import {
  BOM_FRONTS_ATTRIBUTION,
  getBomFrontFeatures,
} from "@/lib/weather/bom-fronts";
import { ensureArchiveMeta } from "@/lib/weather/archive-storage";
import { contourPressureGrid } from "@/lib/weather/synoptic-contour";
import {
  getSynopticFieldAt,
  SYNOPTIC_MODEL,
} from "@/lib/weather/synoptic-grid";
import {
  SYNOPTIC_ATTRIBUTION,
  SYNOPTIC_UTC_HOURS,
  unixToSynopticStamp,
} from "@/lib/weather/synoptic";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

function nearestSynopticUnix(refUnix: number): number {
  let best = 0;
  let bestDist = Infinity;
  const d = new Date(refUnix * 1000);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const base = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() - dayOffset,
      0,
      0,
      0,
    );
    for (const hour of SYNOPTIC_UTC_HOURS) {
      const t = Math.floor(base / 1000) + hour * 3600;
      if (t > refUnix + 3600) continue;
      const dist = refUnix - t;
      if (dist >= 0 && dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
  }
  return best || quantizeFallback(refUnix);
}

function quantizeFallback(refUnix: number): number {
  const d = new Date(refUnix * 1000);
  const hour = d.getUTCHours();
  let bestH: (typeof SYNOPTIC_UTC_HOURS)[number] = SYNOPTIC_UTC_HOURS[0]!;
  for (const h of SYNOPTIC_UTC_HOURS) {
    if (h <= hour) bestH = h;
  }
  return Math.floor(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      bestH,
      0,
      0,
    ) / 1000,
  );
}

async function buildAndStore(unix: number): Promise<ArchiveSynopticRecord> {
  const stamp = unixToSynopticStamp(unix);
  const [field, fronts] = await Promise.all([
    getSynopticFieldAt(unix, AbortSignal.timeout(45_000)),
    getBomFrontFeatures(stamp).catch(() => []),
  ]);
  const geojson = contourPressureGrid(field);
  geojson.features.push(...fronts);
  const attribution = fronts.length
    ? `${SYNOPTIC_ATTRIBUTION} · ${BOM_FRONTS_ATTRIBUTION}`
    : SYNOPTIC_ATTRIBUTION;
  const record: ArchiveSynopticRecord = {
    stamp,
    time: field.validUnix,
    model: SYNOPTIC_MODEL,
    attribution,
    geojson,
  };
  await putSynopticRecord(record);
  return record;
}

/**
 * GET /api/weather/archive/synoptic?time=<unix>
 * Nearest stored synoptic ≤ time; on-demand build+persist if missing and ≥ epoch.
 */
export async function GET(request: NextRequest) {
  const timeRaw = request.nextUrl.searchParams.get("time") ?? "";
  const ref = Number(timeRaw);
  if (!Number.isFinite(ref)) {
    return NextResponse.json({ error: "Invalid time" }, { status: 400 });
  }
  try {
    const meta = await ensureArchiveMeta();
    const target = nearestSynopticUnix(Math.floor(ref));
    if (target < meta.epochUnix - 6 * 3600) {
      return NextResponse.json(
        { error: "Before archive epoch" },
        { status: 404 },
      );
    }
    const stamp = unixToSynopticStamp(target);
    let record = await getSynopticRecord(stamp);
    if (!record) {
      record = await buildAndStore(target);
    }
    return NextResponse.json(record, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("[weather/archive/synoptic]", err);
    return NextResponse.json(
      { error: "Archive synoptic unavailable" },
      { status: 502 },
    );
  }
}
