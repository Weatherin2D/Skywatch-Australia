import { NextResponse } from "next/server";
import { BOM_THUNDERSTORM_CATEGORIES } from "@/lib/weather/bom-thunderstorm";
import { getBomRiskOutlook } from "@/lib/weather/bom-risk-outlook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/weather/risk
 * Catalog of live BoM Day 1–3 convective risk (same source as `/api/forecast`).
 */
export async function GET() {
  try {
    const outlook = await getBomRiskOutlook();
    return NextResponse.json(
      {
        status: outlook.status,
        updatedAt: outlook.issuedAt,
        days: outlook.days.map((d) => {
          const available = (d.legend ?? []).some((item) => item.used);
          return {
            day: d.effectiveDay,
            label: d.label,
            dateLabel: d.dateLabel,
            available,
            imageUrl: available
              ? `/api/weather/risk-image?day=${d.effectiveDay}&t=${encodeURIComponent(outlook.issuedAt ?? "")}`
              : null,
            issuedAt: outlook.issuedAt,
          };
        }),
        legend: BOM_THUNDERSTORM_CATEGORIES,
        source:
          "Bureau of Meteorology daily forecasts + severe thunderstorm warnings",
        message: outlook.message,
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
