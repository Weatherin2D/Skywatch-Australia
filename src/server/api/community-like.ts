import { NextRequest, NextResponse } from "next/server";
import { likeCommunityPost } from "@/lib/community/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/community/like
 * Body JSON: { id, action: "like" | "unlike" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      action?: unknown;
    };
    const id = typeof body.id === "string" ? body.id : "";
    const action = body.action === "unlike" ? "unlike" : "like";
    if (!id) {
      return NextResponse.json({ error: "Missing post id." }, { status: 400 });
    }
    const result = await likeCommunityPost(id, action);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json(
      { post: result.post },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[community/like]", err);
    return NextResponse.json(
      { error: "Could not update like." },
      { status: 500 },
    );
  }
}
