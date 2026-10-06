/**
 * Community abuse controls: per-IP cooldowns, origin checks, honeypots,
 * image magic-byte validation, and basic content hygiene.
 *
 * Cooldowns are stored in Upstash Redis when available so they survive
 * serverless cold starts (local/memory fallback for dev only).
 */

import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { getRedis, redisConfigured } from "@/lib/community/backends";

/** Post + comment publish cooldown per IP. */
export const COMMUNITY_PUBLISH_COOLDOWN_SEC = 20 * 60;
/** Likes: sliding window. */
export const COMMUNITY_LIKE_WINDOW_SEC = 60;
export const COMMUNITY_LIKE_MAX_PER_WINDOW = 40;
/** Soft cap so a single post cannot be flooded with comments. */
export const MAX_COMMENTS_PER_POST = 80;

const memoryCooldowns = new Map<string, number>();
const memoryLikeBuckets = new Map<string, { count: number; resetAt: number }>();

export type ClientIdentity = {
  /** Opaque hashed fingerprint for storage keys (not the raw IP). */
  key: string;
  /** Best-effort IP (may be "unknown"). */
  ip: string;
};

function hashIdentity(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/** Extract client IP from common proxy headers. */
export function getRequestIp(request: NextRequest): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export function getClientIdentity(request: NextRequest): ClientIdentity {
  const ip = getRequestIp(request);
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 180);
  // Prefer IP; fold UA lightly so shared NATs still share a cooldown while
  // pure UA spoofing alone cannot mint unlimited fresh identities.
  const key = hashIdentity([ip || "unknown", ua ? "ua" : "noua"]);
  return { key, ip: ip || "unknown" };
}

function cooldownRedisKey(channel: "post" | "comment", identityKey: string) {
  return `community:cooldown:${channel}:${identityKey}`;
}

function likeRedisKey(identityKey: string) {
  return `community:ratelimit:like:${identityKey}`;
}

export type CooldownBlock = {
  blocked: true;
  retryAfterSec: number;
  error: string;
};

export type CooldownOk = { blocked: false };

export type CooldownResult = CooldownBlock | CooldownOk;

function formatRetry(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

async function redisGetTtlSec(key: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const ttl = await redis.ttl(key);
    if (typeof ttl === "number" && ttl > 0) return ttl;
    if (ttl === -1) {
      // Key without TTL — treat as blocked for a full window.
      return COMMUNITY_PUBLISH_COOLDOWN_SEC;
    }
    return 0;
  } catch (err) {
    console.warn("[community-security] redis ttl failed", err);
    return null;
  }
}

async function redisSetNxEx(
  key: string,
  ttlSec: number,
): Promise<"ok" | "exists" | "error"> {
  const redis = getRedis();
  if (!redis) return "error";
  try {
    // SET key value EX ttl NX — returns "OK" or null
    const result = await redis.set(key, String(Date.now()), {
      ex: ttlSec,
      nx: true,
    });
    return result === "OK" ? "ok" : "exists";
  } catch (err) {
    console.warn("[community-security] redis set nx failed", err);
    return "error";
  }
}

function memoryCheckAndTouch(
  key: string,
  ttlSec: number,
): CooldownResult {
  const now = Date.now();
  const until = memoryCooldowns.get(key) ?? 0;
  if (until > now) {
    const retryAfterSec = Math.ceil((until - now) / 1000);
    return {
      blocked: true,
      retryAfterSec,
      error: `Please wait ${formatRetry(retryAfterSec)} before posting again from this network.`,
    };
  }
  memoryCooldowns.set(key, now + ttlSec * 1000);
  return { blocked: false };
}

/**
 * Enforce a per-IP publish cooldown for posts or comments.
 * Call BEFORE performing the mutation; on success the cooldown is armed.
 */
export async function enforcePublishCooldown(
  identity: ClientIdentity,
  channel: "post" | "comment",
): Promise<CooldownResult> {
  const memKey = `${channel}:${identity.key}`;
  const redisKey = cooldownRedisKey(channel, identity.key);

  if (redisConfigured()) {
    const ttl = await redisGetTtlSec(redisKey);
    if (ttl != null && ttl > 0) {
      return {
        blocked: true,
        retryAfterSec: ttl,
        error: `Please wait ${formatRetry(ttl)} before ${
          channel === "post" ? "publishing another post" : "commenting again"
        } from this network.`,
      };
    }
    const set = await redisSetNxEx(redisKey, COMMUNITY_PUBLISH_COOLDOWN_SEC);
    if (set === "exists") {
      const again = (await redisGetTtlSec(redisKey)) ?? COMMUNITY_PUBLISH_COOLDOWN_SEC;
      return {
        blocked: true,
        retryAfterSec: again,
        error: `Please wait ${formatRetry(again)} before ${
          channel === "post" ? "publishing another post" : "commenting again"
        } from this network.`,
      };
    }
    if (set === "ok") {
      // Mirror into memory for same-instance bursts.
      memoryCooldowns.set(memKey, Date.now() + COMMUNITY_PUBLISH_COOLDOWN_SEC * 1000);
      return { blocked: false };
    }
    // Redis errored — fall through to memory.
  }

  const mem = memoryCheckAndTouch(memKey, COMMUNITY_PUBLISH_COOLDOWN_SEC);
  if (mem.blocked) {
    return {
      ...mem,
      error: `Please wait ${formatRetry(mem.retryAfterSec)} before ${
        channel === "post" ? "publishing another post" : "commenting again"
      } from this network.`,
    };
  }
  return mem;
}

/** Release a cooldown that was armed before a failed mutation. */
export async function releasePublishCooldown(
  identity: ClientIdentity,
  channel: "post" | "comment",
): Promise<void> {
  const memKey = `${channel}:${identity.key}`;
  memoryCooldowns.delete(memKey);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(cooldownRedisKey(channel, identity.key));
  } catch {
    /* ignore */
  }
}

export type LikeLimitResult =
  | { blocked: false }
  | { blocked: true; retryAfterSec: number; error: string };

export async function enforceLikeRateLimit(
  identity: ClientIdentity,
): Promise<LikeLimitResult> {
  const redisKey = likeRedisKey(identity.key);
  if (redisConfigured()) {
    const redis = getRedis();
    if (redis) {
      try {
        const count = await redis.incr(redisKey);
        if (count === 1) {
          await redis.expire(redisKey, COMMUNITY_LIKE_WINDOW_SEC);
        }
        if (typeof count === "number" && count > COMMUNITY_LIKE_MAX_PER_WINDOW) {
          const ttl = (await redis.ttl(redisKey)) || COMMUNITY_LIKE_WINDOW_SEC;
          return {
            blocked: true,
            retryAfterSec: Math.max(1, ttl),
            error: `Too many likes from this network — try again in ${formatRetry(ttl)}.`,
          };
        }
        return { blocked: false };
      } catch (err) {
        console.warn("[community-security] like rate limit redis failed", err);
      }
    }
  }

  const now = Date.now();
  const bucket = memoryLikeBuckets.get(identity.key);
  if (!bucket || bucket.resetAt <= now) {
    memoryLikeBuckets.set(identity.key, {
      count: 1,
      resetAt: now + COMMUNITY_LIKE_WINDOW_SEC * 1000,
    });
    return { blocked: false };
  }
  bucket.count += 1;
  if (bucket.count > COMMUNITY_LIKE_MAX_PER_WINDOW) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      blocked: true,
      retryAfterSec,
      error: `Too many likes from this network — try again in ${formatRetry(retryAfterSec)}.`,
    };
  }
  return { blocked: false };
}

/**
 * Reject cross-site mutating requests. Browsers send Origin / Sec-Fetch-Site;
 * non-browser clients without those headers are allowed (mobile/curl) but still
 * hit IP cooldowns.
 */
export function assertSameOrigin(request: NextRequest): {
  ok: true;
} | { ok: false; error: string } {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") {
    return { ok: false, error: "Cross-site community requests are not allowed." };
  }
  const origin = request.headers.get("origin");
  if (!origin) return { ok: true };
  try {
    const originHost = new URL(origin).host;
    const reqHost =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      request.headers.get("host") ||
      request.nextUrl.host;
    if (originHost && reqHost && originHost !== reqHost) {
      return { ok: false, error: "Origin mismatch." };
    }
  } catch {
    return { ok: false, error: "Invalid Origin." };
  }
  return { ok: true };
}

/** Honeypot: bots often fill hidden "website" / "url" fields. */
export function honeypotTripped(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== "string") return true;
  return value.trim().length > 0;
}

/** Strip control chars and reject obvious link spam. */
export function sanitizeCommunityText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeLinkSpam(text: string): boolean {
  const lower = text.toLowerCase();
  const urlHits = (lower.match(/https?:\/\/|www\.|\.com\/|\.net\/|\.xyz\b/g) ??
    []).length;
  if (urlHits >= 2) return true;
  if (urlHits >= 1 && text.length < 24) return true;
  // Common spam bait tokens
  if (/\b(viagra|crypto\s*giveaway|free\s*followers|telegram\s*@)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function detectImageContentType(
  buffer: Buffer,
  declared: string,
): string | null {
  const declaredType = declared.toLowerCase().split(";")[0]!.trim();
  let magic: string | null = null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    magic = "image/jpeg";
  } else if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    magic = "image/png";
  } else if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    magic = "image/webp";
  }
  if (!magic) return null;
  // Accept jpeg/jpg alias mismatch.
  if (
    declaredType &&
    declaredType !== "application/octet-stream" &&
    declaredType !== magic &&
    !(declaredType === "image/jpg" && magic === "image/jpeg")
  ) {
    // Declared type disagrees with bytes — trust magic, but only if declared is empty-ish or image/*.
    if (declaredType.startsWith("image/") && declaredType !== "image/jpg") {
      return null;
    }
  }
  return magic;
}

export function timingSafeSecretEqual(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still do a compare against itself to keep timing flatter.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function cooldownHeaders(retryAfterSec: number): HeadersInit {
  return {
    "Retry-After": String(Math.max(1, Math.ceil(retryAfterSec))),
    "Cache-Control": "no-store",
  };
}
