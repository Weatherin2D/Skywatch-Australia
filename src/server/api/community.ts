import { NextRequest, NextResponse } from "next/server";
import {
  createCommunityPost,
  deleteCommunityPost,
  getCommunityAdminSecret,
  getCommunityStorageStatusFresh,
  isCommunityAdminAuthorized,
  listCommunityPosts,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_POST,
} from "@/lib/community/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/community — list weather photo posts (newest first).
 * POST /api/community — multipart create (title, author, caption, eventDate, image|images).
 * DELETE /api/community — admin-only delete via secret.
 */
export async function GET() {
  try {
    const [posts, storage] = await Promise.all([
      listCommunityPosts(),
      getCommunityStorageStatusFresh(),
    ]);
    return NextResponse.json(
      {
        posts,
        adminDeleteConfigured: Boolean(getCommunityAdminSecret()),
        storage,
      },
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

function collectImageFiles(form: FormData): File[] {
  const files: File[] = [];
  const multi = form.getAll("images");
  for (const item of multi) {
    if (item instanceof File && item.size > 0) files.push(item);
  }
  if (files.length === 0) {
    const singles = form.getAll("image");
    for (const item of singles) {
      if (item instanceof File && item.size > 0) files.push(item);
    }
  }
  return files;
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
    const caption = form.get("caption");
    const eventDate = form.get("eventDate");
    const files = collectImageFiles(form);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "At least one photo is required." },
        { status: 400 },
      );
    }
    if (files.length > MAX_IMAGES_PER_POST) {
      return NextResponse.json(
        {
          error: `You can upload up to ${MAX_IMAGES_PER_POST} photos per post.`,
        },
        { status: 400 },
      );
    }

    for (let i = 0; i < files.length; i++) {
      if (files[i]!.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: `Photo ${i + 1} must be 5 MB or smaller.` },
          { status: 400 },
        );
      }
    }

    const images = await Promise.all(
      files.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || "application/octet-stream",
      })),
    );

    const result = await createCommunityPost({
      title,
      author,
      caption,
      eventDate,
      images,
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

export async function DELETE(request: NextRequest) {
  try {
    if (!getCommunityAdminSecret()) {
      return NextResponse.json(
        { error: "Admin delete is not configured on this server." },
        { status: 503 },
      );
    }

    const headerSecret = request.headers.get("x-community-admin-secret");
    let id = request.nextUrl.searchParams.get("id") ?? "";
    let bodySecret: string | null = null;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await request.json()) as {
          secret?: unknown;
          id?: unknown;
        };
        if (typeof body.secret === "string") bodySecret = body.secret;
        if (!id && typeof body.id === "string") id = body.id;
      } catch {
        return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
      }
    }

    if (!isCommunityAdminAuthorized(headerSecret ?? bodySecret)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (!id) {
      return NextResponse.json({ error: "Missing post id." }, { status: 400 });
    }

    const result = await deleteCommunityPost(id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[community] DELETE", err);
    return NextResponse.json(
      { error: "Could not delete community post." },
      { status: 500 },
    );
  }
}
