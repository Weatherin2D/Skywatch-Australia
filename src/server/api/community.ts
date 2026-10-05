import { NextRequest, NextResponse } from "next/server";
import {
  createCommunityPost,
  listCommunityPosts,
  MAX_IMAGE_BYTES,
} from "@/lib/community/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/community — list weather photo posts (newest first).
 * POST /api/community — multipart create (title, author, eventDate, image).
 */
export async function GET() {
  try {
    const posts = await listCommunityPosts();
    return NextResponse.json(
      { posts },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    console.error("[community]", err);
    return NextResponse.json(
      { error: "Could not load community posts." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart form data." },
        { status: 400 },
      );
    }

    const form = await request.formData();
    const title = form.get("title");
    const author = form.get("author");
    const eventDate = form.get("eventDate");
    const image = form.get("image");

    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "An image file is required." },
        { status: 400 },
      );
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image must be 5 MB or smaller." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const result = await createCommunityPost({
      title,
      author,
      eventDate,
      image: {
        buffer,
        contentType: image.type || "application/octet-stream",
      },
    });

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
    console.error("[community] POST", err);
    return NextResponse.json(
      { error: "Could not publish community post." },
      { status: 500 },
    );
  }
}
