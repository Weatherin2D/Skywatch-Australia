/** Process-local cache for proxied Himawari/GIBS frames. */
type CacheEntry = {
  body: Buffer;
  contentType: string;
  cachedAt: number;
};

const g = globalThis as unknown as {
  __skywatchFrameCache?: Map<string, CacheEntry>;
};

function store(): Map<string, CacheEntry> {
  if (!g.__skywatchFrameCache) g.__skywatchFrameCache = new Map();
  return g.__skywatchFrameCache;
}

const MAX_ENTRIES = 120;
const TTL_MS = 6 * 60 * 60 * 1000;

export function frameCacheKey(product: string, timeUnix: number): string {
  return `${product}:${timeUnix}`;
}

export function getCachedFrame(
  product: string,
  timeUnix: number,
): CacheEntry | null {
  const key = frameCacheKey(product, timeUnix);
  const entry = store().get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    store().delete(key);
    return null;
  }
  return entry;
}

export function setCachedFrame(
  product: string,
  timeUnix: number,
  body: Buffer,
  contentType: string,
): void {
  const cache = store();
  if (cache.size >= MAX_ENTRIES) {
    // Drop oldest
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of cache) {
      if (v.cachedAt < oldestAt) {
        oldestAt = v.cachedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(frameCacheKey(product, timeUnix), {
    body,
    contentType,
    cachedAt: Date.now(),
  });
}
