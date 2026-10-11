import { NextRequest, NextResponse } from "next/server";
import {
  createCommunityPost,
  deleteCommunityPost,
  getCommunityAdminSecret,
  isCommunityAdminAuthorized,
  listCommunityPosts,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_POST,
} from "@/lib/community/storage";
import {
  assertSameOrigin,
  COMMUNITY_PUBLISH_COOLDOWN_SEC,
  cooldownHeaders,
  enforcePublishCooldown,
  getClientIdentity,
  honeypotTripped,
  releasePublishCooldown,
} from "@/lib/community/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/community — list weather photo posts (newest first).
 * POST /api/community — multipart create (title, author, caption, eventDate, image|images).
 * DELETE /api/community — admin-only delete via secret.
 */
export async function GET() {
  try {
    const posts = await listCommunityPosts();
    return NextResponse.json(
      {
        posts,
        adminDeleteConfigured: Boolean(getCommunityAdminSecret()),
        security: {
          publishCooldownSec: COMMUNITY_PUBLISH_COOLDOWN_SEC,
        },
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
  const identity = getClientIdentity(request);
  try {
    const origin = assertSameOrigin(request);
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: 403 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart form data." },
        { status: 400 },
      );
    }

    const form = await request.formData();
    // Honeypot — real users never fill this (hidden in the form).
    if (
      honeypotTripped(form.get("website")) ||
      honeypotTripped(form.get("company"))
    ) {
      // Fake success so bots do not retry-adapt.
      return NextResponse.json(
        { ok: true },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }

    const cooldown = await enforcePublishCooldown(identity, "post");
    if (cooldown.blocked) {
      return NextResponse.json(
        {
          error: cooldown.error,
          retryAfterSec: cooldown.retryAfterSec,
        },
        {
          status: 429,
          headers: cooldownHeaders(cooldown.retryAfterSec),
        },
      );
    }

    const title = form.get("title");
    const author = form.get("author");
    const caption = form.get("caption");
    const eventDate = form.get("eventDate");
    const files = collectImageFiles(form);

    if (files.length === 0) {
      await releasePublishCooldown(identity, "post");
      return NextResponse.json(
        { error: "At least one photo is required." },
        { status: 400 },
      );
    }
    if (files.length > MAX_IMAGES_PER_POST) {
      await releasePublishCooldown(identity, "post");
      return NextResponse.json(
        {
          error: `You can upload up to ${MAX_IMAGES_PER_POST} photos per post.`,
        },
        { status: 400 },
      );
    }

    for (let i = 0; i < files.length; i++) {
      if (files[i]!.size > MAX_IMAGE_BYTES) {
        await releasePublishCooldown(identity, "post");
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
      // Do not punish validation / storage failures with a full cooldown.
      await releasePublishCooldown(identity, "post");
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        post: result.post,
        cooldownSec: COMMUNITY_PUBLISH_COOLDOWN_SEC,
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    console.error("[community] POST", err);
    await releasePublishCooldown(identity, "post").catch(() => undefined);
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

    const origin = assertSameOrigin(request);
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: 403 });
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
