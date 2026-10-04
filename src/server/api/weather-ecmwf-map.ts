import { NextRequest, NextResponse } from "next/server";
import { getEcmwfMapCatalog } from "@/lib/weather/ecmwf-map";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/weather/ecmwf-map?product=temperature_2m&model=ecmwf */
export async function GET(req: NextRequest) {
  try {
    const product = req.nextUrl.searchParams.get("product");
    const model = req.nextUrl.searchParams.get("model");
    const catalog = await getEcmwfMapCatalog(product, model);
    return NextResponse.json(catalog, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ECMWF map catalog unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
