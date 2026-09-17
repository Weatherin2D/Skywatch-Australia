import { NextResponse } from "next/server";
import {
  BOM_FRONTS_ATTRIBUTION,
  getBomFrontFeatures,
} from "@/lib/weather/bom-fronts";
import { contourPressureGrid } from "@/lib/weather/synoptic-contour";
import {
  getSynopticFieldAt,
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

    const field = await getSynopticFieldAt(now);
    const latestStamp = unixToSynopticStamp(field.validUnix);
    const geojsonBase = contourPressureGrid(field);
    const fronts = await getBomFrontFeatures(latestStamp);
    const geojson = {
      ...geojsonBase,
      features: [...geojsonBase.features, ...fronts],
    };
    const latest =
      buildSynopticFrame(latestStamp) ??
      frames.find((f) => Math.abs(f.time - field.validUnix) < 3600) ??
      frames[0] ??
      null;

    if (latest && !frames.some((f) => f.stamp === latest.stamp)) {
      frames.unshift(latest);
    }

    const attribution = fronts.length
      ? `${SYNOPTIC_ATTRIBUTION} · ${BOM_FRONTS_ATTRIBUTION}`
      : SYNOPTIC_ATTRIBUTION;

    const payload: SynopticPayload = {
      generated: now,
      product: SYNOPTIC_PRODUCT,
      model: SYNOPTIC_MODEL,
      frames,
      latest,
      geojson,
      validTime: field.validUnix,
      attribution,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Synoptic-Model": SYNOPTIC_MODEL,
        "X-Fronts-Source": fronts.length ? "bom-idy00030" : "none",
        "X-Fronts-Count": String(fronts.length),
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
