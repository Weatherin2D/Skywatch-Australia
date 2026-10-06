/**
 * Community weather photo posts.
 * Prefers Vercel Blob; falls back to /tmp/skywatch-community when Blob is
 * unavailable (missing token, suspended store, network errors).
 */

import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { del, get, list, put } from "@vercel/blob";
import type {
  CommunityComment,
  CommunityPost,
} from "@/lib/community/types";

export type { CommunityPost, CommunityComment } from "@/lib/community/types";

const LOCAL_ROOT = path.join(
  process.env.TMPDIR || "/tmp",
  "skywatch-community",
);
const BLOB_PREFIX = "community/";
const POSTS_PREFIX = "community/posts/";
const IMAGES_PREFIX = "community/images/";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TITLE_LEN = 80;
export const MAX_AUTHOR_LEN = 60;
export const MAX_CAPTION_LEN = 280;
export const MAX_COMMENT_LEN = 400;

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type BlobAccess = "public" | "private";

let blobDisabled = false;

function blobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_STORE_ID ||
      (process.env.VERCEL && process.env.VERCEL_OIDC_TOKEN),
  );
}

function useBlobStorage() {
  return blobConfigured() && !blobDisabled;
}

function preferredAccessOrder(): BlobAccess[] {
  const forced = process.env.BLOB_ACCESS?.toLowerCase();
  if (forced === "private") return ["private"];
  if (forced === "public") return ["public"];
  return ["public", "private"];
}

function isBlobFatalError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("suspended") ||
    m.includes("not found") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("access denied") ||
    m.includes("no token") ||
    m.includes("store does not exist")
  );
}

function disableBlob(reason: string) {
  if (blobDisabled) return;
  blobDisabled = true;
  console.warn(
    `[community-storage] Blob disabled — falling back to local: ${reason}`,
  );
}

function localPath(pathname: string): string {
  return path.join(LOCAL_ROOT, pathname.replace(/^community\//, ""));
}

async function ensureLocalDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function putLocal(
  pathname: string,
  body: Buffer | string,
): Promise<void> {
  const fp = localPath(pathname);
  await ensureLocalDir(fp);
  await fs.writeFile(fp, body);
}

async function getLocal(pathname: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(localPath(pathname));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

async function deleteLocal(pathname: string): Promise<void> {
  try {
    await fs.unlink(localPath(pathname));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return;
    throw error;
  }
}

async function putBytes(
  pathname: string,
  body: Buffer | string,
  contentType: string,
): Promise<void> {
  if (useBlobStorage()) {
    const errors: string[] = [];
    for (const access of preferredAccessOrder()) {
      try {
        await put(pathname, body, {
          access,
          contentType,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 86_400,
        });
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`put(${access}): ${msg}`);
        if (isBlobFatalError(msg)) {
          disableBlob(msg);
          break;
        }
      }
    }
    console.warn(
      `[community-storage] Blob put failed for ${pathname}; using local. ${errors.join(" | ")}`,
    );
  }
  await putLocal(pathname, body);
}

async function getBytes(pathname: string): Promise<Buffer | null> {
  if (useBlobStorage()) {
    for (const access of preferredAccessOrder()) {
      try {
        const result = await get(pathname, { access, useCache: false });
        if (!result || result.statusCode === 304) continue;
        if (!result.stream) continue;
        const ab = await new Response(result.stream).arrayBuffer();
        return Buffer.from(ab);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (isBlobFatalError(msg)) {
          disableBlob(msg);
          break;
        }
      }
    }
  }
  return getLocal(pathname);
}

async function deleteBytes(pathname: string): Promise<void> {
  if (useBlobStorage()) {
    try {
      await del(pathname);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isBlobFatalError(msg)) disableBlob(msg);
      console.warn(
        `[community-storage] Blob delete failed for ${pathname}; trying local. ${msg}`,
      );
    }
  }
  await deleteLocal(pathname);
}

async function listLocalPrefix(
  prefix: string,
): Promise<{ pathname: string }[]> {
  const abs = localPath(prefix);
  const out: { pathname: string }[] = [];
  async function walk(dir: string, basePath: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const nextPath = `${basePath}/${ent.name}`;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, nextPath);
      else out.push({ pathname: nextPath });
    }
  }
  await walk(abs, prefix.replace(/\/$/, ""));
  return out;
}

async function listPrefix(prefix: string): Promise<{ pathname: string }[]> {
  if (useBlobStorage()) {
    try {
      const out: { pathname: string }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        for (const b of page.blobs) {
          out.push({ pathname: b.pathname });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isBlobFatalError(msg)) disableBlob(msg);
      console.warn(
        `[community-storage] Blob list failed for ${prefix}; using local. ${msg}`,
      );
    }
  }
  return listLocalPrefix(prefix);
}

function newId(): string {
  const ts = Date.now().toString(36);
  const nonce = randomBytes(6).toString("hex");
  return `${ts}-${nonce}`;
}

function isValidEventDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function normalizeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function normalizeOptionalText(value: unknown, max: number): string | null {
  if (value == null || value === "") return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length > max) return null;
  return trimmed;
}

function isComment(value: unknown): value is CommunityComment {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.author === "string" &&
    typeof c.text === "string" &&
    typeof c.createdAt === "string"
  );
}

function normalizePost(value: unknown): CommunityPost | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (
    typeof p.id !== "string" ||
    typeof p.title !== "string" ||
    typeof p.author !== "string" ||
    typeof p.eventDate !== "string" ||
    typeof p.imageUrl !== "string" ||
    typeof p.contentType !== "string" ||
    typeof p.imagePath !== "string" ||
    typeof p.createdAt !== "string"
  ) {
    return null;
  }
  const commentsRaw = Array.isArray(p.comments) ? p.comments : [];
  const comments = commentsRaw.filter(isComment);
  const likes =
    typeof p.likes === "number" && Number.isFinite(p.likes) && p.likes >= 0
      ? Math.floor(p.likes)
      : 0;
  const caption = typeof p.caption === "string" ? p.caption : "";
  return {
    id: p.id,
    title: p.title,
    author: p.author,
    caption,
    eventDate: p.eventDate,
    imageUrl: p.imageUrl,
    contentType: p.contentType,
    imagePath: p.imagePath,
    createdAt: p.createdAt,
    likes,
    comments,
  };
}

async function writePost(post: CommunityPost): Promise<void> {
  await putBytes(
    `${POSTS_PREFIX}${post.id}.json`,
    JSON.stringify(post),
    "application/json",
  );
}

export function imageUrlForId(id: string): string {
  return `/api/community/image?id=${encodeURIComponent(id)}`;
}

export function getCommunityAdminSecret(): string | null {
  const secret = process.env.COMMUNITY_ADMIN_SECRET?.trim();
  return secret ? secret : null;
}

export function isCommunityAdminAuthorized(requestSecret: string | null): boolean {
  const expected = getCommunityAdminSecret();
  if (!expected || !requestSecret) return false;
  return requestSecret === expected;
}

export async function listCommunityPosts(): Promise<CommunityPost[]> {
  const files = await listPrefix(POSTS_PREFIX);
  const posts: CommunityPost[] = [];
  for (const { pathname } of files) {
    if (!pathname.endsWith(".json")) continue;
    const buf = await getBytes(pathname);
    if (!buf) continue;
    try {
      const parsed = JSON.parse(buf.toString("utf8")) as unknown;
      const post = normalizePost(parsed);
      if (post) posts.push(post);
    } catch {
      // skip corrupt records
    }
  }
  posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return posts;
}

export async function getCommunityPost(
  id: string,
): Promise<CommunityPost | null> {
  if (!/^[a-z0-9]+-[a-f0-9]+$/i.test(id)) return null;
  const buf = await getBytes(`${POSTS_PREFIX}${id}.json`);
  if (!buf) return null;
  try {
    const parsed = JSON.parse(buf.toString("utf8")) as unknown;
    return normalizePost(parsed);
  } catch {
    return null;
  }
}

export async function getCommunityImage(
  id: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const post = await getCommunityPost(id);
  if (!post) return null;
  const body = await getBytes(post.imagePath);
  if (!body) return null;
  return { body, contentType: post.contentType };
}

export type CreateCommunityPostInput = {
  title: unknown;
  author: unknown;
  caption?: unknown;
  eventDate: unknown;
  image: {
    buffer: Buffer;
    contentType: string;
  };
};

export type CreateCommunityPostResult =
  | { ok: true; post: CommunityPost }
  | { ok: false; error: string; status: number };

export async function createCommunityPost(
  input: CreateCommunityPostInput,
): Promise<CreateCommunityPostResult> {
  const title = normalizeText(input.title, MAX_TITLE_LEN);
  if (!title) {
    return {
      ok: false,
      error: `Title is required (max ${MAX_TITLE_LEN} characters).`,
      status: 400,
    };
  }
  const author = normalizeText(input.author, MAX_AUTHOR_LEN);
  if (!author) {
    return {
      ok: false,
      error: `Author is required (max ${MAX_AUTHOR_LEN} characters).`,
      status: 400,
    };
  }
  const caption = normalizeOptionalText(input.caption, MAX_CAPTION_LEN);
  if (caption == null) {
    return {
      ok: false,
      error: `Caption must be ${MAX_CAPTION_LEN} characters or fewer.`,
      status: 400,
    };
  }
  const eventDateRaw =
    typeof input.eventDate === "string" ? input.eventDate.trim() : "";
  if (!isValidEventDate(eventDateRaw)) {
    return {
      ok: false,
      error: "Event date must be YYYY-MM-DD.",
      status: 400,
    };
  }

  const contentType = input.image.contentType.toLowerCase().split(";")[0]!.trim();
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return {
      ok: false,
      error: "Image must be JPEG, PNG, or WebP.",
      status: 400,
    };
  }
  if (!input.image.buffer.length) {
    return { ok: false, error: "Image file is empty.", status: 400 };
  }
  if (input.image.buffer.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: "Image must be 5 MB or smaller.",
      status: 400,
    };
  }

  const id = newId();
  const imagePath = `${IMAGES_PREFIX}${id}.${ext}`;
  const createdAt = new Date().toISOString();
  const post: CommunityPost = {
    id,
    title,
    author,
    caption,
    eventDate: eventDateRaw,
    imageUrl: imageUrlForId(id),
    contentType,
    imagePath,
    createdAt,
    likes: 0,
    comments: [],
  };

  await putBytes(imagePath, input.image.buffer, contentType);
  await writePost(post);

  return { ok: true, post };
}

export type MutateResult =
  | { ok: true; post: CommunityPost }
  | { ok: false; error: string; status: number };

export async function likeCommunityPost(
  id: string,
  direction: "like" | "unlike",
): Promise<MutateResult> {
  const post = await getCommunityPost(id);
  if (!post) return { ok: false, error: "Post not found.", status: 404 };
  if (direction === "like") {
    post.likes += 1;
  } else {
    post.likes = Math.max(0, post.likes - 1);
  }
  await writePost(post);
  return { ok: true, post };
}

export async function addCommunityComment(
  id: string,
  authorRaw: unknown,
  textRaw: unknown,
): Promise<MutateResult> {
  const post = await getCommunityPost(id);
  if (!post) return { ok: false, error: "Post not found.", status: 404 };
  const author = normalizeText(authorRaw, MAX_AUTHOR_LEN);
  if (!author) {
    return {
      ok: false,
      error: `Comment author is required (max ${MAX_AUTHOR_LEN} characters).`,
      status: 400,
    };
  }
  const text = normalizeText(textRaw, MAX_COMMENT_LEN);
  if (!text) {
    return {
      ok: false,
      error: `Comment is required (max ${MAX_COMMENT_LEN} characters).`,
      status: 400,
    };
  }
  const comment: CommunityComment = {
    id: newId(),
    author,
    text,
    createdAt: new Date().toISOString(),
  };
  post.comments = [...post.comments, comment];
  await writePost(post);
  return { ok: true, post };
}

export async function deleteCommunityPost(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const post = await getCommunityPost(id);
  if (!post) return { ok: false, error: "Post not found.", status: 404 };
  await deleteBytes(post.imagePath);
  await deleteBytes(`${POSTS_PREFIX}${post.id}.json`);
  return { ok: true };
}

/** Kept for debugging / tests. */
export function communityBlobPrefix() {
  return BLOB_PREFIX;
}
