import { NextRequest, NextResponse } from "next/server";
import { renderEcmwfFrame } from "@/lib/weather/ecmwf-map";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W3ZoAAAAASUVORK5CYII=",
  "base64",
);

/**
 * GET /api/weather/ecmwf-map/frame?product=temperature_2m&time=…&model=ecmwf&diff=gfs
 */
export async function GET(req: NextRequest) {
  const product = req.nextUrl.searchParams.get("product");
  const time = req.nextUrl.searchParams.get("time");
  const model = req.nextUrl.searchParams.get("model");
  const diffModel =
    req.nextUrl.searchParams.get("diff") ||
    req.nextUrl.searchParams.get("diffModel");
  const force =
    req.nextUrl.searchParams.get("force") === "1" ||
    req.nextUrl.searchParams.get("refresh") === "1";

  try {
    const result = await renderEcmwfFrame({
      productId: product,
      time,
      force,
      model,
      diffModel,
    });
    const png = result.empty ? EMPTY_PNG : result.png;
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": result.empty
          ? "no-store"
          : "public, max-age=90, stale-while-revalidate=300",
        "X-Ecmwf-Product": result.productId,
        "X-Ecmwf-Time": result.time ?? "",
        "X-Ecmwf-Units": result.units,
        "X-Ecmwf-Min": result.min == null ? "" : String(result.min),
        "X-Ecmwf-Max": result.max == null ? "" : String(result.max),
        "X-Ecmwf-Empty": result.empty ? "1" : "0",
        "X-Ecmwf-Model": model ?? "ecmwf",
        "X-Ecmwf-Diff": diffModel ?? "",
      },
    });
  } catch (err) {
    console.error("[weather/ecmwf-map/frame]", err);
    return new NextResponse(new Uint8Array(EMPTY_PNG), {
      status: 502,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Ecmwf-Empty": "1",
      },
    });
  }
}
