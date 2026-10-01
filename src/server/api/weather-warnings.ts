import { NextRequest, NextResponse } from "next/server";
import {
  fetchBomWarningDetail,
  fetchBomWarningList,
  statesWithWarnings,
} from "@/lib/weather/warnings";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function warningIdFromRequest(req: NextRequest): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("id");
  if (q) return q.trim();
  const parts = url.pathname.split("/").filter(Boolean);
  // /api/weather/warnings/:id
  const idx = parts.findIndex((p) => p === "warnings");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const id = warningIdFromRequest(req);
    if (id) {
      const detail = await fetchBomWarningDetail(id);
      if (!detail) {
        return NextResponse.json(
          { error: "Warning not found" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        {
          warning: detail,
          attribution:
            "Bureau of Meteorology — official warning text and maps.",
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          },
        },
      );
    }

    const warnings = await fetchBomWarningList();
    return NextResponse.json(
      {
        generated: new Date().toISOString(),
        count: warnings.length,
        activeCount: warnings.filter((w) => w.severity !== "cancelled").length,
        states: statesWithWarnings(warnings),
        warnings,
        attribution:
          "Bureau of Meteorology — official Australian weather warnings.",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Warnings unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
