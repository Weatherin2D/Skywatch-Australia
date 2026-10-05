import { NextRequest, NextResponse } from "next/server";
import {
  probeMeteyeThunderstorm,
  isMeteyeOutlookDay,
} from "@/lib/weather/bom-meteye-thunderstorm";
import {
  probeModelRisk,
  isModelRiskDay,
  resolveModelRiskKind,
  resolveModelRiskProduct,
} from "@/lib/weather/auto-risk-outlook";
import { explainCategoryDefinition } from "@/lib/weather/auto-risk-probe";
import {
  METEYE_THUNDERSTORM_CATEGORIES,
} from "@/lib/weather/bom-meteye-constants";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/weather/risk-probe?source=&product=&day=&lat=&lon=
 * Optional: &category=low_tstorm — return category definition only (legend tap).
 */
export async function GET(req: NextRequest) {
  const sourceParam = (req.nextUrl.searchParams.get("source") || "bom")
    .trim()
    .toLowerCase();
  const modelKind = resolveModelRiskKind(sourceParam);
  const product = resolveModelRiskProduct(
    req.nextUrl.searchParams.get("product"),
  );
  const categoryId = (req.nextUrl.searchParams.get("category") || "").trim();
  const dayNum = Number(req.nextUrl.searchParams.get("day") || "1");

  try {
    if (categoryId) {
      if (sourceParam === "bom" || (!modelKind && sourceParam === "bom")) {
        const cat = METEYE_THUNDERSTORM_CATEGORIES.find(
          (c) => c.id === categoryId,
        );
        if (!cat) {
          return NextResponse.json(
            { error: "Unknown MetEye category" },
            { status: 404 },
          );
        }
        return NextResponse.json({
          kind: "category",
          id: cat.id,
          label: cat.label,
          color: cat.color,
          blurb:
            cat.id === "tstm_likely"
              ? "Thunderstorms are likely in the period — plan for lightning and local heavy rain."
              : "At least a low chance of thunderstorms in the period — isolated cells possible.",
          productLabel: "BoM thunderstorms",
        });
      }
      const def = explainCategoryDefinition(product, categoryId);
      if (!def) {
        return NextResponse.json(
          { error: "Unknown category" },
          { status: 404 },
        );
      }
      return NextResponse.json({ kind: "category", ...def });
    }

    const lat = Number(req.nextUrl.searchParams.get("lat"));
    const lon = Number(
      req.nextUrl.searchParams.get("lon") ??
        req.nextUrl.searchParams.get("lng"),
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "lat and lon are required" },
        { status: 400 },
      );
    }

    if (modelKind) {
      if (!isModelRiskDay(dayNum)) {
        return NextResponse.json(
          { error: "day must be a model outlook day (1–7)" },
          { status: 400 },
        );
      }
      const force =
        req.nextUrl.searchParams.get("force") === "1" ||
        req.nextUrl.searchParams.get("refresh") === "1";
      const probe = await probeModelRisk(modelKind, {
        day: dayNum,
        lat,
        lon,
        product,
        force,
      });
      if (!probe) {
        return NextResponse.json(
          { error: "Risk probe unavailable" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { kind: "point", ...probe },
        {
          headers: {
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          },
        },
      );
    }

    if (!isMeteyeOutlookDay(dayNum)) {
      return NextResponse.json(
        { error: "day must be a MetEye outlook day (1–8)" },
        { status: 400 },
      );
    }
    const probe = await probeMeteyeThunderstorm(dayNum, lat, lon);
    if (!probe) {
      return NextResponse.json(
        { error: "MetEye probe unavailable" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { kind: "point", ...probe },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    console.error("[weather/risk-probe]", err);
    return NextResponse.json(
      { error: "Risk probe unavailable" },
      { status: 502 },
    );
  }
}
