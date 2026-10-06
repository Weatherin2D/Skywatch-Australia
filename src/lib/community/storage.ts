/**
 * Community weather photo posts — durable across deploys.
 *
 * Backend preference:
 *  1. Upstash Redis (KV_REST_API_URL + KV_REST_API_TOKEN) — survives deploys
 *  2. Vercel Blob when healthy — survives deploys
 *  3. Local /tmp — development only (never used for mutations on Vercel)
 */

import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { del, get, list, put } from "@vercel/blob";
import {
  blobConfigured,
  getRedis,
  isVercelRuntime,
  redisConfigured,
  resolveBackend,
  storageStatus,
  type StorageStatus,
} from "@/lib/community/backends";
import type {
  CommunityComment,
  CommunityPost,
} from "@/lib/community/types";

export type { CommunityPost, CommunityComment } from "@/lib/community/types";
export type { StorageStatus } from "@/lib/community/backends";

const LOCAL_ROOT = path.join(
  process.env.TMPDIR || "/tmp",
  "skywatch-community",
);
const BLOB_PREFIX = "community/";
const POSTS_PREFIX = "community/posts/";
const IMAGES_PREFIX = "community/images/";

const REDIS_INDEX = "community:index";
const redisPostKey = (id: string) => `community:post:${id}`;
const redisImageKey = (id: string) => `community:image:${id}`;

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
let blobDisableReason: string | null = null;

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
    m.includes("store does not exist") ||
    m.includes("limits-exceeded") ||
    m.includes("billing")
  );
}

function disableBlob(reason: string) {
  if (blobDisabled) return;
  blobDisabled = true;
  blobDisableReason = reason;
  console.warn(`[community-storage] Blob disabled: ${reason}`);
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

async function putBlobBytes(
  pathname: string,
  body: Buffer | string,
  contentType: string,
): Promise<boolean> {
  if (!useBlobStorage()) return false;
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
      return true;
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
    `[community-storage] Blob put failed for ${pathname}. ${errors.join(" | ")}`,
  );
  return false;
}

async function getBlobBytes(pathname: string): Promise<Buffer | null> {
  if (!useBlobStorage()) return null;
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
  return null;
}

async function deleteBlobBytes(pathname: string): Promise<void> {
  if (!useBlobStorage()) return;
  try {
    await del(pathname);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isBlobFatalError(msg)) disableBlob(msg);
    console.warn(
      `[community-storage] Blob delete failed for ${pathname}: ${msg}`,
    );
  }
}

async function listBlobPrefix(
  prefix: string,
): Promise<{ pathname: string }[]> {
  if (!useBlobStorage()) return [];
  try {
    const out: { pathname: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) out.push({ pathname: b.pathname });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isBlobFatalError(msg)) disableBlob(msg);
    console.warn(
      `[community-storage] Blob list failed for ${prefix}: ${msg}`,
    );
    return [];
  }
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

export function imageUrlForId(id: string): string {
  return `/api/community/image?id=${encodeURIComponent(id)}`;
}

export function getCommunityAdminSecret(): string | null {
  const secret = process.env.COMMUNITY_ADMIN_SECRET?.trim();
  return secret ? secret : null;
}

export function isCommunityAdminAuthorized(
  requestSecret: string | null,
): boolean {
  const expected = getCommunityAdminSecret();
  if (!expected || !requestSecret) return false;
  return requestSecret === expected;
}

export function getCommunityStorageStatus(): StorageStatus {
  return storageStatus(!blobDisabled);
}

function durableRequiredError(): {
  ok: false;
  error: string;
  status: number;
} {
  const status = getCommunityStorageStatus();
  return {
    ok: false,
    error: `Community storage is not durable right now (${status.detail}). Posts were not saved — fix Blob/Redis, then try again.`,
    status: 503,
  };
}

function activeBackend() {
  return resolveBackend(!blobDisabled);
}

/* ---------------- Redis helpers ---------------- */

async function redisListPosts(): Promise<CommunityPost[]> {
  const redis = getRedis();
  if (!redis) return [];
  const ids = (await redis.lrange(REDIS_INDEX, 0, -1)) as string[];
  if (!ids.length) return [];
  const posts: CommunityPost[] = [];
  for (const id of ids) {
    const raw = await redis.get(redisPostKey(id));
    const post = normalizePost(raw);
    if (post) posts.push(post);
  }
  return posts;
}

async function redisGetPost(id: string): Promise<CommunityPost | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(redisPostKey(id));
  return normalizePost(raw);
}

async function redisWritePost(
  post: CommunityPost,
  image?: { buffer: Buffer; contentType: string },
  opts?: { addToIndex?: boolean },
): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");
  await redis.set(redisPostKey(post.id), post);
  if (image) {
    await redis.set(redisImageKey(post.id), {
      contentType: image.contentType,
      data: image.buffer.toString("base64"),
    });
  }
  if (opts?.addToIndex) {
    // Newest first — remove any stale id then push left.
    await redis.lrem(REDIS_INDEX, 0, post.id);
    await redis.lpush(REDIS_INDEX, post.id);
  }
}

async function redisDeletePost(post: CommunityPost): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");
  await redis.del(redisPostKey(post.id));
  await redis.del(redisImageKey(post.id));
  await redis.lrem(REDIS_INDEX, 0, post.id);
}

async function redisGetImage(
  id: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(redisImageKey(id));
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as { contentType?: unknown; data?: unknown };
  if (typeof rec.contentType !== "string" || typeof rec.data !== "string") {
    return null;
  }
  return {
    contentType: rec.contentType,
    body: Buffer.from(rec.data, "base64"),
  };
}

/* ---------------- Blob/local helpers ---------------- */

async function blobLocalListPosts(): Promise<CommunityPost[]> {
  const files = useBlobStorage()
    ? await listBlobPrefix(POSTS_PREFIX)
    : await listLocalPrefix(POSTS_PREFIX);
  // If blob list empty/failed and we're in local/dev, also scan local.
  const localFiles =
    !isVercelRuntime() && useBlobStorage()
      ? await listLocalPrefix(POSTS_PREFIX)
      : [];
  const seen = new Set<string>();
  const posts: CommunityPost[] = [];
  for (const { pathname } of [...files, ...localFiles]) {
    if (!pathname.endsWith(".json") || seen.has(pathname)) continue;
    seen.add(pathname);
    const buf =
      (await getBlobBytes(pathname)) ?? (await getLocal(pathname));
    if (!buf) continue;
    try {
      const post = normalizePost(JSON.parse(buf.toString("utf8")) as unknown);
      if (post) posts.push(post);
    } catch {
      // skip
    }
  }
  posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return posts;
}

async function blobLocalGetPost(id: string): Promise<CommunityPost | null> {
  if (!/^[a-z0-9]+-[a-f0-9]+$/i.test(id)) return null;
  const pathname = `${POSTS_PREFIX}${id}.json`;
  const buf = (await getBlobBytes(pathname)) ?? (await getLocal(pathname));
  if (!buf) return null;
  try {
    return normalizePost(JSON.parse(buf.toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

async function blobLocalWritePost(
  post: CommunityPost,
  image?: { buffer: Buffer; contentType: string },
): Promise<"blob" | "local"> {
  if (image) {
    const blobOk = await putBlobBytes(
      post.imagePath,
      image.buffer,
      image.contentType,
    );
    if (!blobOk) {
      if (isVercelRuntime()) {
        throw new Error(
          blobDisableReason ||
            "Blob write failed; refusing ephemeral /tmp on Vercel.",
        );
      }
      await putLocal(post.imagePath, image.buffer);
    }
  }

  const json = JSON.stringify(post);
  const blobOk = await putBlobBytes(
    `${POSTS_PREFIX}${post.id}.json`,
    json,
    "application/json",
  );
  if (blobOk) return "blob";
  if (isVercelRuntime()) {
    throw new Error(
      blobDisableReason ||
        "Blob write failed; refusing ephemeral /tmp on Vercel.",
    );
  }
  await putLocal(`${POSTS_PREFIX}${post.id}.json`, json);
  return "local";
}

async function blobLocalDeletePost(post: CommunityPost): Promise<void> {
  await deleteBlobBytes(post.imagePath);
  await deleteBlobBytes(`${POSTS_PREFIX}${post.id}.json`);
  if (!isVercelRuntime()) {
    await deleteLocal(post.imagePath);
    await deleteLocal(`${POSTS_PREFIX}${post.id}.json`);
  }
}

async function blobLocalGetImage(
  post: CommunityPost,
): Promise<{ body: Buffer; contentType: string } | null> {
  const body =
    (await getBlobBytes(post.imagePath)) ?? (await getLocal(post.imagePath));
  if (!body) return null;
  return { body, contentType: post.contentType };
}

/* ---------------- Public API ---------------- */

export async function listCommunityPosts(): Promise<CommunityPost[]> {
  const backend = activeBackend();
  if (backend === "redis") {
    const posts = await redisListPosts();
    // Also merge any still-present blob/local posts (migration window).
    if (useBlobStorage() || !isVercelRuntime()) {
      const extras = await blobLocalListPosts();
      const ids = new Set(posts.map((p) => p.id));
      for (const p of extras) {
        if (!ids.has(p.id)) posts.push(p);
      }
      posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }
    return posts;
  }
  return blobLocalListPosts();
}

export async function getCommunityPost(
  id: string,
): Promise<CommunityPost | null> {
  if (!/^[a-z0-9]+-[a-f0-9]+$/i.test(id)) return null;
  if (activeBackend() === "redis") {
    const fromRedis = await redisGetPost(id);
    if (fromRedis) return fromRedis;
  }
  return blobLocalGetPost(id);
}

export async function getCommunityImage(
  id: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (activeBackend() === "redis") {
    const fromRedis = await redisGetImage(id);
    if (fromRedis) return fromRedis;
  }
  const post = await getCommunityPost(id);
  if (!post) return null;
  return blobLocalGetImage(post);
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
  const backend = activeBackend();
  if (backend === "none") return durableRequiredError();

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

  const contentType = input.image.contentType
    .toLowerCase()
    .split(";")[0]!
    .trim();
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
  const post: CommunityPost = {
    id,
    title,
    author,
    caption,
    eventDate: eventDateRaw,
    imageUrl: imageUrlForId(id),
    contentType,
    imagePath,
    createdAt: new Date().toISOString(),
    likes: 0,
    comments: [],
  };

  try {
    if (backend === "redis") {
      await redisWritePost(
        post,
        { buffer: input.image.buffer, contentType },
        { addToIndex: true },
      );
      // Best-effort mirror to Blob when healthy (extra durability).
      if (useBlobStorage()) {
        void blobLocalWritePost(post, {
          buffer: input.image.buffer,
          contentType,
        }).catch(() => undefined);
      }
    } else {
      await blobLocalWritePost(post, {
        buffer: input.image.buffer,
        contentType,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[community-storage] create failed", msg);
    if (isVercelRuntime()) return durableRequiredError();
    return { ok: false, error: msg, status: 500 };
  }

  return { ok: true, post };
}

export type MutateResult =
  | { ok: true; post: CommunityPost }
  | { ok: false; error: string; status: number };

async function persistPostUpdate(post: CommunityPost): Promise<MutateResult> {
  const backend = activeBackend();
  if (backend === "none") return durableRequiredError();
  try {
    if (backend === "redis") {
      await redisWritePost(post);
      if (useBlobStorage()) {
        void blobLocalWritePost(post).catch(() => undefined);
      }
    } else {
      await blobLocalWritePost(post);
    }
    return { ok: true, post };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[community-storage] update failed", msg);
    if (isVercelRuntime()) return durableRequiredError();
    return { ok: false, error: msg, status: 500 };
  }
}

export async function likeCommunityPost(
  id: string,
  direction: "like" | "unlike",
): Promise<MutateResult> {
  const post = await getCommunityPost(id);
  if (!post) return { ok: false, error: "Post not found.", status: 404 };
  if (direction === "like") post.likes += 1;
  else post.likes = Math.max(0, post.likes - 1);
  return persistPostUpdate(post);
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
  post.comments = [
    ...post.comments,
    {
      id: newId(),
      author,
      text,
      createdAt: new Date().toISOString(),
    },
  ];
  return persistPostUpdate(post);
}

export async function deleteCommunityPost(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const post = await getCommunityPost(id);
  if (!post) return { ok: false, error: "Post not found.", status: 404 };
  const backend = activeBackend();
  if (backend === "none") return durableRequiredError();
  try {
    if (backend === "redis" || redisConfigured()) {
      await redisDeletePost(post);
    }
    await blobLocalDeletePost(post);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[community-storage] delete failed", msg);
    return { ok: false, error: msg, status: 500 };
  }
}

export function communityBlobPrefix() {
  return BLOB_PREFIX;
}
