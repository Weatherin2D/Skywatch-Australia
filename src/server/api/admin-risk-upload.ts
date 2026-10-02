import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { MAP_REGIONS, type MapRegionId } from "@/components/home/mock-data";
import {
  isBomThunderstormDay,
  type BomRiskDisplay,
} from "@/lib/weather/bom-thunderstorm";
import {
  clearBomRiskDay,
  saveBomRiskImage,
} from "@/lib/weather/bom-thunderstorm-storage";

export const dynamic = "force-dynamic";

const REGION_IDS = new Set(MAP_REGIONS.map((r) => r.id));

/**
 * POST /api/admin/risk-upload
 * multipart: file, day (1-3), regionId, display (sheet|geo)
 *
 * DELETE /api/admin/risk-upload?day=1
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get("file");
    const dayNum = Number(form.get("day"));
    const regionId = String(form.get("regionId") || "national") as MapRegionId;
    const display = (String(form.get("display") || "sheet") as BomRiskDisplay);
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!isBomThunderstormDay(dayNum)) {
      return NextResponse.json({ error: "Day must be 1, 2 or 3" }, { status: 400 });
    }
    if (!REGION_IDS.has(regionId)) {
      return NextResponse.json({ error: "Invalid region" }, { status: 400 });
    }
    if (display !== "sheet" && display !== "geo") {
      return NextResponse.json({ error: "Invalid display mode" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "File must be an image" }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 12MB)" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const rec = await saveBomRiskImage({
      day: dayNum,
      buffer,
      contentType: file.type,
      fileName: file.name,
      regionId,
      display,
    });
    return NextResponse.json({ status: "ok", day: rec });
  } catch (err) {
    console.error("[admin/risk-upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dayNum = Number(req.nextUrl.searchParams.get("day"));
  if (!isBomThunderstormDay(dayNum)) {
    return NextResponse.json({ error: "Day must be 1, 2 or 3" }, { status: 400 });
  }
  try {
    await clearBomRiskDay(dayNum);
    return NextResponse.json({ status: "ok", day: dayNum });
  } catch (err) {
    console.error("[admin/risk-upload DELETE]", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
