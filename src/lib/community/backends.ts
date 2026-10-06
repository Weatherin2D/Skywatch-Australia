import { Redis } from "@upstash/redis";
import type {
  CommunityBackend,
  StorageStatus,
} from "@/lib/community/types";

export type { CommunityBackend, StorageStatus } from "@/lib/community/types";

export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL);
}

export function redisConfigured(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

export function blobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_STORE_ID ||
      (process.env.VERCEL && process.env.VERCEL_OIDC_TOKEN),
  );
}

let redisClient: Redis | null = null;

export function getRedis(): Redis | null {
  if (!redisConfigured()) return null;
  if (!redisClient) {
    redisClient = Redis.fromEnv();
  }
  return redisClient;
}

/**
 * Prefer Redis (durable KV) when configured, then Blob, then local (dev only).
 * On Vercel, local is never considered durable.
 */
export function resolveBackend(blobHealthy: boolean): CommunityBackend {
  if (redisConfigured()) return "redis";
  if (blobConfigured() && blobHealthy) return "blob";
  if (!isVercelRuntime()) return "local";
  return "none";
}

export function storageStatus(blobHealthy: boolean): StorageStatus {
  const backend = resolveBackend(blobHealthy);
  if (backend === "redis") {
    return {
      durable: true,
      backend,
      vercel: isVercelRuntime(),
      detail: "Upstash Redis — posts survive deploys.",
    };
  }
  if (backend === "blob") {
    return {
      durable: true,
      backend,
      vercel: isVercelRuntime(),
      detail: "Vercel Blob — posts survive deploys.",
    };
  }
  if (backend === "local") {
    return {
      durable: false,
      backend,
      vercel: false,
      detail: "Local /tmp only — fine for development, not for production.",
    };
  }
  return {
    durable: false,
    backend: "none",
    vercel: isVercelRuntime(),
    detail:
      "No durable storage available. Vercel Blob is suspended/unavailable and Redis is not configured.",
  };
}
