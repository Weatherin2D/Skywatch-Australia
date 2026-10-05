import { NextRequest, NextResponse } from "next/server";
import { getCommunityImage } from "@/lib/community/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/community/image?id=
 * Serves a stored community weather photo.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  try {
    const got = await getCommunityImage(id);
    if (!got) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(got.body), {
      headers: {
        "Content-Type": got.contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("[community/image]", err);
    return NextResponse.json(
      { error: "Image unavailable" },
      { status: 500 },
    );
  }
}
