import { NextResponse } from "next/server";
import { contourPressureGrid } from "@/lib/weather/synoptic-contour";
import {
  getPressureGridAt,
  loadRawPressureField,
  SYNOPTIC_MODEL,
} from "@/lib/weather/synoptic-grid";
import {
  SYNOPTIC_ATTRIBUTION,
  SYNOPTIC_PRODUCT,
  buildSynopticFrame,
  listSynopticCandidateStamps,
  unixToSynopticStamp,
  type SynopticPayload,
} from "@/lib/weather/synoptic";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  try {
    const now = Math.floor(Date.now() / 1000);
    await loadRawPressureField();

    const frames = listSynopticCandidateStamps(now, 2)
      .map((stamp) => buildSynopticFrame(stamp))
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .slice(0, 12);

    const grid = await getPressureGridAt(now);
    const geojson = contourPressureGrid(grid);
    const latestStamp = unixToSynopticStamp(grid.validUnix);
    const latest =
      buildSynopticFrame(latestStamp) ??
      frames.find((f) => Math.abs(f.time - grid.validUnix) < 3600) ??
      frames[0] ??
      null;

    if (latest && !frames.some((f) => f.stamp === latest.stamp)) {
      frames.unshift(latest);
    }

    const payload: SynopticPayload = {
      generated: now,
      product: SYNOPTIC_PRODUCT,
      model: SYNOPTIC_MODEL,
      frames,
      latest,
      geojson,
      validTime: grid.validUnix,
      attribution: SYNOPTIC_ATTRIBUTION,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Synoptic-Model": SYNOPTIC_MODEL,
      },
    });
  } catch (err) {
    console.error("synoptic catalog failed", err);
    return NextResponse.json(
      { error: "Synoptic field unavailable" },
      { status: 502 },
    );
  }
}
