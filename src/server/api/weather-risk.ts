import { NextRequest, NextResponse } from "next/server";
import { METEYE_THUNDERSTORM_CATEGORIES } from "@/lib/weather/bom-meteye-constants";
import { getMeteyeThunderstormOutlook } from "@/lib/weather/bom-meteye-thunderstorm";
import {
  getModelRiskCatalog,
  resolveModelRiskKind,
} from "@/lib/weather/auto-risk-outlook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/weather/risk?source=bom|pulse|access|auto
 * Catalog of thunderstorm risk — BoM MetEye (default), SkyWatch Pulse, or Access.
 * `auto` is accepted as a legacy alias for `pulse`.
 */
export async function GET(req: NextRequest) {
  const sourceParam = (req.nextUrl.searchParams.get("source") || "bom")
    .trim()
    .toLowerCase();
  const modelKind = resolveModelRiskKind(sourceParam);

  try {
    if (modelKind) {
      const force =
        req.nextUrl.searchParams.get("force") === "1" ||
        req.nextUrl.searchParams.get("refresh") === "1";
      const catalog = await getModelRiskCatalog(modelKind, { force });
      const cacheControl =
        catalog.status === "ok"
          ? "public, max-age=120, stale-while-revalidate=600"
          : "no-store";
      return NextResponse.json(catalog, {
        headers: { "Cache-Control": cacheControl },
      });
    }

    const outlook = await getMeteyeThunderstormOutlook();
    return NextResponse.json(
      {
        status: outlook.status,
        source: "bom" as const,
        updatedAt: outlook.issuedAt,
        issuedAt: outlook.issuedAt,
        days: outlook.days.map((d) => {
          const available = (d.legend ?? []).some((item) => item.used);
          return {
            day: d.effectiveDay,
            label: d.label,
            dateLabel: d.dateLabel,
            available,
            imageUrl: available
              ? `/api/weather/risk-image?source=bom&day=${d.effectiveDay}&t=${encodeURIComponent(outlook.issuedAt ?? "")}`
              : null,
            issuedAt: outlook.issuedAt,
            legend: d.legend,
          };
        }),
        legend: METEYE_THUNDERSTORM_CATEGORIES,
        attribution:
          "Bureau of Meteorology MetEye thunderstorm forecast (IDZ73094)",
        message: outlook.message,
        outlook,
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
