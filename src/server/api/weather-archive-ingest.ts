import { NextRequest, NextResponse } from "next/server";
import { runArchiveIngest } from "@/lib/weather/archive-ingest";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Local/dev: allow when no secret configured.
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = request.nextUrl.searchParams.get("secret");
  return q === secret;
}

/**
 * GET /api/weather/archive/ingest
 * Vercel Cron + manual trigger.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runArchiveIngest();
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[weather/archive/ingest]", err);
    return NextResponse.json(
      { error: "Archive ingest failed" },
      { status: 500 },
    );
  }
}
