/**
 * In-memory cache for synoptic GeoJSON fields.
 *
 * Satellite playback crosses only a few 6-hourly analyses. Keeping those
 * parsed FeatureCollections in memory avoids blank/flicker frames when the
 * loop jumps or scrubs between stamps (HTTP prefetch alone is not enough —
 * the overlay used to fetch with cache: "no-store").
 */

import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";

const cache = new Map<string, SynopticGeoJson>();
const inflight = new Map<string, Promise<SynopticGeoJson | null>>();

export function getCachedSynopticGeoJson(
  url: string,
): SynopticGeoJson | null {
  return cache.get(url) ?? null;
}

export function seedSynopticGeoJson(url: string, geojson: SynopticGeoJson) {
  if (!url || !geojson) return;
  cache.set(url, geojson);
}

export async function loadSynopticGeoJson(
  url: string,
): Promise<SynopticGeoJson | null> {
  const hit = cache.get(url);
  if (hit) return hit;

  const pending = inflight.get(url);
  if (pending) return pending;

  const req = (async () => {
    try {
      const res = await fetch(url, {
        // Allow browser HTTP cache; memory cache is still the source of truth.
        cache: "force-cache",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { geojson?: SynopticGeoJson };
      const geojson = data.geojson ?? null;
      if (geojson) cache.set(url, geojson);
      return geojson;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, req);
  return req;
}

/** Warm the memory cache for every URL (deduped, parallel). */
export async function prefetchSynopticGeoJson(
  urls: Iterable<string>,
): Promise<void> {
  const unique = [...new Set(urls)].filter(Boolean);
  await Promise.all(unique.map((url) => loadSynopticGeoJson(url)));
}
