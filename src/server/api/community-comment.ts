import { NextRequest, NextResponse } from "next/server";
import {
  addCommunityComment,
  deleteCommunityComment,
  getCommunityAdminSecret,
  isCommunityAdminAuthorized,
} from "@/lib/community/storage";

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

/**
 * DELETE /api/community/comment
 * Admin-only. Body/query: { id (post), commentId, secret }
 */
export async function DELETE(request: NextRequest) {
  try {
    if (!getCommunityAdminSecret()) {
      return NextResponse.json(
        { error: "Admin delete is not configured on this server." },
        { status: 503 },
      );
    }

    const headerSecret = request.headers.get("x-community-admin-secret");
    let postId = request.nextUrl.searchParams.get("id") ?? "";
    let commentId = request.nextUrl.searchParams.get("commentId") ?? "";
    let bodySecret: string | null = null;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await request.json()) as {
          secret?: unknown;
          id?: unknown;
          commentId?: unknown;
        };
        if (typeof body.secret === "string") bodySecret = body.secret;
        if (!postId && typeof body.id === "string") postId = body.id;
        if (!commentId && typeof body.commentId === "string") {
          commentId = body.commentId;
        }
      } catch {
        return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
      }
    }

    if (!isCommunityAdminAuthorized(headerSecret ?? bodySecret)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (!postId) {
      return NextResponse.json({ error: "Missing post id." }, { status: 400 });
    }
    if (!commentId) {
      return NextResponse.json(
        { error: "Missing comment id." },
        { status: 400 },
      );
    }

    const result = await deleteCommunityComment(postId, commentId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json(
      { ok: true, post: result.post },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[community/comment] DELETE", err);
    return NextResponse.json(
      { error: "Could not delete comment." },
      { status: 500 },
    );
  }
}
