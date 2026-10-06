import { NextRequest, NextResponse } from "next/server";
import { addCommunityComment } from "@/lib/community/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/community/comment
 * Body JSON: { id, author, text }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      author?: unknown;
      text?: unknown;
    };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "Missing post id." }, { status: 400 });
    }
    const result = await addCommunityComment(id, body.author, body.text);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json(
      { post: result.post },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    console.error("[community/comment]", err);
    return NextResponse.json(
      { error: "Could not add comment." },
      { status: 500 },
    );
  }
}
