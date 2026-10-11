"use client";

import { useEffect, useMemo, useRef } from "react";
import { TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import {
  RADAR_NATIVE_MAX_ZOOM,
  radarWarmupTileUrls,
} from "@/lib/weather/radar-palette";
import type { WeatherFrame } from "@/lib/weather/maps";

const TRANSPARENT_TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function createBufferLayer(zIndex: number, smoothed: boolean): L.TileLayer {
  return L.tileLayer("", {
    opacity: 0,
    className: smoothed
      ? "skywatch-radar-tiles skywatch-radar-tiles--smooth"
      : "skywatch-radar-tiles",
    // Hold a slightly larger tile ring so the next frame is ready before the
    // user sees the transition, without flooding every pan with a fresh tile set.
    keepBuffer: 8,
    // Keep painted tiles through the gesture so the map doesn't blank while a
    // pan/zoom is settling.
    updateWhenIdle: true,
    updateWhenZooming: false,
    updateInterval: 90,
    zIndex,
    // RainViewer only has real data through ~z7. Overzoom past that so tight
    // zooms keep showing scaled reflectivity instead of empty z8–12 tiles.
    maxZoom: 22,
    maxNativeZoom: RADAR_NATIVE_MAX_ZOOM,
    minZoom: 0,
    errorTileUrl: TRANSPARENT_TILE,
    crossOrigin: true,
  });
}

/**
 * Dual-buffer radar tiles with instant hard cuts on frame change.
 *
 * Playback must not wait for the next frame to finish loading — set the new
 * URL and reveal immediately so the animation snaps frame-to-frame.
 */
export function SmoothRadarLayer({
  url,
  opacity = 0.88,
  smoothed = false,
}: {
  url: string | null;
  opacity?: number;
  /** RainViewer spatial smooth — also softens CSS image-rendering. */
  smoothed?: boolean;
}) {
  const warmCacheRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!url) return;
    const now = Date.now();
    const prev = warmCacheRef.current.get(url);
    if (prev && now - prev < 90_000) return;
    warmCacheRef.current.set(url, now);
    if (warmCacheRef.current.size > 24) {
      const oldestKey = warmCacheRef.current.keys().next().value as
        string | undefined;
      if (oldestKey) warmCacheRef.current.delete(oldestKey);
    }
    const img = new window.Image();
    img.decoding = "async";
    img.src = url;
  }, [url]);

  if (!url) return null;

  return (
    <TileLayer
      url={url}
      opacity={opacity}
      zIndex={450}
      tileSize={256}
      className={
        smoothed
          ? "skywatch-radar-tiles skywatch-radar-tiles--smooth"
          : "skywatch-radar-tiles"
      }
      keepBuffer={12}
      updateWhenIdle
      updateWhenZooming={false}
      updateInterval={90}
      maxZoom={22}
      maxNativeZoom={RADAR_NATIVE_MAX_ZOOM}
      minZoom={0}
      errorTileUrl={TRANSPARENT_TILE}
      crossOrigin
    />
  );
}

/**
 * Prefetch AU radar tiles for nearby timeline frames into the browser cache
 * so playback advances without waiting on the network.
 */
export function useRadarFramePreloader(
  frames: WeatherFrame[],
  activeIndex: number,
  enabled: boolean,
) {
  const map = useMap();
  const warmed = useRef(new Map<string, number>());
  const VIEW_CACHE_TTL_MS = 2 * 60 * 1000;

  const templates = useMemo(
    () =>
      frames
        .map((f) => f.tileUrlTemplate)
        .filter((u): u is string => Boolean(u)),
    [frames],
  );

  useEffect(() => {
    if (!enabled || templates.length === 0) {
      warmed.current.clear();
      return;
    }

    let cancelled = false;
    const queue: string[] = [];

    const viewportBounds = () => {
      try {
        const b = map.getBounds();
        return {
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        };
      } catch {
        return undefined;
      }
    };

    const zoomLevels = () => {
      let z = 5;
      try {
        z = Math.round(map.getZoom());
      } catch {
        /* map may be tearing down */
      }
      const native = Math.max(3, Math.min(RADAR_NATIVE_MAX_ZOOM, z));
      if (z > RADAR_NATIVE_MAX_ZOOM) {
        const coarser = Math.max(3, RADAR_NATIVE_MAX_ZOOM - 1);
        return [coarser, RADAR_NATIVE_MAX_ZOOM];
      }
      const coarser = Math.max(3, native - 1);
      const finer = native < RADAR_NATIVE_MAX_ZOOM ? native + 1 : native;
      return [...new Set([coarser, native, finer])];
    };

    const pushFrame = (idx: number, force = false) => {
      const tpl = templates[idx];
      if (!tpl) return;
      const zooms = zoomLevels();
      const cacheKey = `${tpl}|${zooms.join(",")}|${Math.round(map.getZoom())}`;
      const lastWarm = warmed.current.get(cacheKey) ?? 0;
      if (!force && Date.now() - lastWarm < VIEW_CACHE_TTL_MS) return;
      warmed.current.set(cacheKey, Date.now());
      const bounds = viewportBounds();
      // Viewport-sized warm — keep caps low for Hobby invoke budget.
      const cap = zooms.includes(RADAR_NATIVE_MAX_ZOOM) ? 24 : 16;
      for (const url of radarWarmupTileUrls(tpl, zooms, bounds, cap)) {
        queue.push(url);
      }
    };

    const n = templates.length;
    // Warm a short local window so the next several frames are already in the
    // browser cache; clear this temporary cache when the map view changes.
    pushFrame(activeIndex % n, true);
    for (let step = 1; step <= Math.min(8, n - 1); step++) {
      pushFrame((activeIndex + step) % n);
    }

    let active = 0;
    const CONCURRENCY = 8;
    const pump = () => {
      while (!cancelled && active < CONCURRENCY && queue.length > 0) {
        const url = queue.shift()!;
        active += 1;
        const img = new window.Image();
        const done = () => {
          active -= 1;
          pump();
        };
        img.onload = done;
        img.onerror = done;
        img.decoding = "async";
        img.src = url;
      }
    };
    pump();

    let moveTimer: number | null = null;
    const onViewChange = () => {
      warmed.current.clear();
      if (moveTimer != null) window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => {
        if (cancelled) return;
        // Re-warm the playhead + next few frames only after pan/zoom settles.
        for (const step of [0, 1, 2, 3]) {
          pushFrame((activeIndex + step) % n, true);
        }
        pump();
      }, 200);
    };
    map.on("moveend", onViewChange);
    map.on("zoomend", onViewChange);

    return () => {
      cancelled = true;
      if (moveTimer != null) window.clearTimeout(moveTimer);
      warmed.current.clear();
      map.off("moveend", onViewChange);
      map.off("zoomend", onViewChange);
    };
  }, [enabled, templates, activeIndex, map]);
}

/** Must sit inside MapContainer — warms radar tiles around the playhead. */
export function RadarFramePreloader({
  frames,
  activeIndex,
  enabled,
}: {
  frames: WeatherFrame[];
  activeIndex: number;
  enabled: boolean;
}) {
  useRadarFramePreloader(frames, activeIndex, enabled);
  return null;
}
