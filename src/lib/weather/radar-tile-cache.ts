/** Process-local LRU cache for recoloured RainViewer radar tiles. */

type CacheEntry = {
  body: Buffer;
  cachedAt: number;
};

const g = globalThis as unknown as {
  __skywatchRadarTileCache?: Map<string, CacheEntry>;
};

function store(): Map<string, CacheEntry> {
  if (!g.__skywatchRadarTileCache) g.__skywatchRadarTileCache = new Map();
  return g.__skywatchRadarTileCache;
}

const MAX_ENTRIES = 2400;
const TTL_MS = 90 * 60 * 1000;

export function radarTileCacheKey(
  host: string,
  path: string,
  z: number,
  x: number,
  y: number,
  smooth = false,
): string {
  // v9: canonical user-specified CloudCountry dBZ ladder (swdbz3)
  return `${host}|${path}|${z}/${x}/${y}|v9|s${smooth ? 1 : 0}`;
}

export function getCachedRadarTile(key: string): Buffer | null {
  const entry = store().get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    store().delete(key);
    return null;
  }
  // Refresh LRU order
  store().delete(key);
  store().set(key, entry);
  return entry.body;
}

export function setCachedRadarTile(key: string, body: Buffer): void {
  const cache = store();
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { body, cachedAt: Date.now() });
}
