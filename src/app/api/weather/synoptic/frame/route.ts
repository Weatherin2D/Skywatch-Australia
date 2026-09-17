import { NextRequest, NextResponse } from "next/server";
import { contourPressureGrid } from "@/lib/weather/synoptic-contour";
import {
  getSynopticFieldAt,
  SYNOPTIC_MODEL,
} from "@/lib/weather/synoptic-grid";
import {
  SYNOPTIC_ATTRIBUTION,
  isValidSynopticStamp,
  synopticStampToUnix,
  type SynopticFieldPayload,
} from "@/lib/weather/synoptic";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/**
 * Vector MSLP field for a valid-time stamp.
 * Returns GeoJSON (isobars, H/L, fronts, troughs).
 */
export async function GET(request: NextRequest) {
  const stamp = request.nextUrl.searchParams.get("time") ?? "";
  if (!isValidSynopticStamp(stamp)) {
    return NextResponse.json({ error: "Invalid synoptic time" }, { status: 400 });
  }
  const unix = synopticStampToUnix(stamp);
  if (unix == null) {
    return NextResponse.json({ error: "Invalid synoptic time" }, { status: 400 });
  }

  try {
    const field = await getSynopticFieldAt(unix);
    const geojson = contourPressureGrid(field);
    const payload: SynopticFieldPayload = {
      stamp,
      time: field.validUnix,
      model: SYNOPTIC_MODEL,
      attribution: SYNOPTIC_ATTRIBUTION,
      geojson,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "Content-Type": "application/json",
        "X-Synoptic-Model": SYNOPTIC_MODEL,
        "X-Synoptic-Valid": field.validTimeIso,
      },
    });
  } catch (err) {
    console.error("synoptic field failed", err);
    return NextResponse.json(
      { error: "Synoptic field unavailable" },
      { status: 502 },
    );
  }
}
