import { NextRequest, NextResponse } from "next/server";
import {
  getMeteyeThunderstormDayPng,
  isMeteyeOutlookDay,
} from "@/lib/weather/bom-meteye-thunderstorm";
import {
  getModelRiskDayPng,
  isModelRiskDay,
  resolveModelRiskKind,
  resolveModelRiskProduct,
} from "@/lib/weather/auto-risk-outlook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W3ZoAAAAASUVORK5CYII=",
  "base64",
);

/**
 * GET /api/weather/risk-image?source=bom|pulse|…&product=risk|tstorm|…&day=1…N
 * BoM MetEye PNG (default) or CloudCountry model risk / hazard-chance raster.
 */
export async function GET(req: NextRequest) {
  const sourceParam = (req.nextUrl.searchParams.get("source") || "bom")
    .trim()
    .toLowerCase();
  const modelKind = resolveModelRiskKind(sourceParam);
  const product = resolveModelRiskProduct(
    req.nextUrl.searchParams.get("product"),
  );
  const dayNum = Number(req.nextUrl.searchParams.get("day") || "1");

  try {
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
      const result = await getModelRiskDayPng(modelKind, dayNum, {
        force,
        product,
      });
      const png = !result || result.empty ? EMPTY_PNG : result.png;
      return new NextResponse(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control":
            !result || result.empty
              ? "no-store"
              : "public, max-age=120, stale-while-revalidate=600",
          "X-Risk-Display": "geo",
          "X-Risk-Source": modelKind,
          "X-Risk-Product": product,
          ...(result?.issuedAt
            ? { "X-Model-Issued-At": result.issuedAt }
            : {}),
        },
      });
    }

    if (!isMeteyeOutlookDay(dayNum)) {
      return NextResponse.json(
        { error: "day must be a MetEye outlook day (1–8)" },
        { status: 400 },
      );
    }

    const result = await getMeteyeThunderstormDayPng(dayNum);
    const png = !result || result.empty ? EMPTY_PNG : result.png;

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
        "X-Risk-Display": "geo",
        "X-Risk-Source": "bom",
        "X-Risk-Product": "risk",
        "X-BoM-Product": "IDZ73094",
        ...(result?.issuedAt ? { "X-BoM-Issued-At": result.issuedAt } : {}),
      },
    });
  } catch (err) {
    console.error("[weather/risk-image]", err);
    return NextResponse.json(
      { error: "Risk image unavailable" },
      { status: 502 },
    );
  }
}
