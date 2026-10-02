import { NextResponse } from "next/server";
import {
  BOM_THUNDERSTORM_CATEGORIES,
  bomRiskDayLabels,
  boundsForRiskRegion,
  type BomRiskDayPublic,
  type BomThunderstormDay,
} from "@/lib/weather/bom-thunderstorm";
import {
  ensureSeedBomRiskManifest,
  readBomRiskManifest,
} from "@/lib/weather/bom-thunderstorm-storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/weather/risk
 * Day 1–3 BoM thunderstorm forecast chart catalog.
 */
export async function GET() {
  try {
    await ensureSeedBomRiskManifest();
    const manifest = await readBomRiskManifest();
    const labels = bomRiskDayLabels();
    const days: BomRiskDayPublic[] = ([1, 2, 3] as BomThunderstormDay[]).map(
      (day) => {
        const rec = manifest.days[String(day) as "1" | "2" | "3"];
        const available = Boolean(rec?.imagePath);
        return {
          day,
          label: labels[day].label,
          dateLabel: labels[day].dateLabel,
          available,
          issuedAt: rec?.issuedAt ?? null,
          regionId: rec?.regionId ?? "national",
          display: rec?.display ?? "sheet",
          imageUrl: available
            ? `/api/weather/risk-image?day=${day}&t=${encodeURIComponent(manifest.updatedAt)}`
            : null,
          imageBounds: boundsForRiskRegion(rec?.regionId ?? "national"),
        };
      },
    );

    return NextResponse.json(
      {
        status: days.some((d) => d.available) ? "ok" : "empty",
        updatedAt: manifest.updatedAt,
        days,
        legend: BOM_THUNDERSTORM_CATEGORIES,
        source: "Bureau of Meteorology thunderstorm forecast charts",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    console.error("[weather/risk]", err);
    return NextResponse.json(
      { error: "Risk outlook unavailable" },
      { status: 502 },
    );
  }
}
