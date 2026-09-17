import { NextRequest, NextResponse } from "next/server";
import { contourPressureGrid } from "@/lib/weather/synoptic-contour";
import { getPressureGridAt, SYNOPTIC_MODEL } from "@/lib/weather/synoptic-grid";
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
 * Vector MSLP field for a 6-hourly stamp.
 * Returns GeoJSON FeatureCollection (isobars + H/L centres).
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
    const grid = await getPressureGridAt(unix);
    const geojson = contourPressureGrid(grid);
    const payload: SynopticFieldPayload = {
      stamp,
      time: grid.validUnix,
      model: SYNOPTIC_MODEL,
      attribution: SYNOPTIC_ATTRIBUTION,
      geojson,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "Content-Type": "application/json",
        "X-Synoptic-Model": SYNOPTIC_MODEL,
        "X-Synoptic-Valid": grid.validTimeIso,
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
