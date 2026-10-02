import { NextResponse } from "next/server";
import { METEYE_THUNDERSTORM_CATEGORIES } from "@/lib/weather/bom-meteye-constants";
import { getMeteyeThunderstormOutlook } from "@/lib/weather/bom-meteye-thunderstorm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/weather/risk
 * Catalog of live BoM MetEye Day 1–3 thunderstorm risk (same source as `/api/forecast`).
 */
export async function GET() {
  try {
    const outlook = await getMeteyeThunderstormOutlook();
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
        legend: METEYE_THUNDERSTORM_CATEGORIES,
        source: "Bureau of Meteorology MetEye thunderstorm forecast (IDZ73094)",
        message: outlook.message,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
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
