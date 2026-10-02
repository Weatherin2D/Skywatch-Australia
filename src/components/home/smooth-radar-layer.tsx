"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { radarWarmupTileUrls } from "@/lib/weather/radar-palette";
import type { WeatherFrame } from "@/lib/weather/maps";

function createBufferLayer(zIndex: number): L.TileLayer {
  return L.tileLayer("", {
    opacity: 0,
    className: "skywatch-radar-tiles",
    keepBuffer: 12,
    updateWhenIdle: false,
    updateWhenZooming: false,
    zIndex,
    // RainViewer only serves up to z12 — overzoom past that so tight zooms
    // still show scaled radar instead of vanishing.
    maxZoom: 18,
    maxNativeZoom: 12,
  });
}

/**
 * Dual-buffer radar tiles: keep the current frame fully visible until the next
 * frame's visible tiles have loaded, then snap instantly. Never remounts layers
 * on frame change (remounting was the blank-flash source).
 */
export function SmoothRadarLayer({
  url,
  opacity = 0.88,
}: {
  url: string | null;
  opacity?: number;
}) {
  const map = useMap();
  const buffersRef = useRef<[L.TileLayer, L.TileLayer] | null>(null);
  const frontRef = useRef(0);
  const displayedUrlRef = useRef<string | null>(null);
  const pendingUrlRef = useRef<string | null>(null);
  const loadGenRef = useRef(0);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;

  useEffect(() => {
    const a = createBufferLayer(450);
    const b = createBufferLayer(451);
    buffersRef.current = [a, b];
    a.addTo(map);
    b.addTo(map);
    return () => {
      loadGenRef.current += 1;
      a.off();
      b.off();
      map.removeLayer(a);
      map.removeLayer(b);
      buffersRef.current = null;
      displayedUrlRef.current = null;
      pendingUrlRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const buffers = buffersRef.current;
    if (!buffers || !displayedUrlRef.current) return;
    buffers[frontRef.current]!.setOpacity(opacity);
  }, [opacity]);

  useEffect(() => {
    const buffers = buffersRef.current;
    if (!buffers) return;

    if (!url) {
      loadGenRef.current += 1;
      pendingUrlRef.current = null;
      displayedUrlRef.current = null;
      buffers[0]!.setOpacity(0);
      buffers[1]!.setOpacity(0);
      return;
    }

    if (url === displayedUrlRef.current) {
      // Cancel any stale in-flight load for an older target.
      if (pendingUrlRef.current && pendingUrlRef.current !== url) {
        loadGenRef.current += 1;
        pendingUrlRef.current = null;
      }
      return;
    }

    if (url === pendingUrlRef.current) return;

    const frontIdx = frontRef.current;
    const backIdx = 1 - frontIdx;
    const front = buffers[frontIdx]!;
    const back = buffers[backIdx]!;
    const gen = ++loadGenRef.current;
    pendingUrlRef.current = url;

    const reveal = (layer: L.TileLayer, hide: L.TileLayer, newFront: number) => {
      if (gen !== loadGenRef.current) return;
      if (pendingUrlRef.current !== url) return;
      layer.setOpacity(opacityRef.current);
      layer.setZIndex(451);
      hide.setOpacity(0);
      hide.setZIndex(450);
      frontRef.current = newFront;
      displayedUrlRef.current = url;
      pendingUrlRef.current = null;
    };

    // Force redraw even when the buffer already holds this URL (loop wrap),
    // otherwise Leaflet's setUrl no-ops and `load` never fires.
    const loadInto = (layer: L.TileLayer, onReady: () => void) => {
      layer.off("load");
      layer.once("load", onReady);
      layer.setOpacity(0);
      layer.setUrl(url, false);
    };

    // First paint: load into the front buffer and show when ready.
    if (!displayedUrlRef.current) {
      loadInto(front, () => reveal(front, back, frontIdx));
      return;
    }

    // Subsequent frames: load into the hidden back buffer, then snap.
    loadInto(back, () => reveal(back, front, backIdx));
  }, [url]);

  return null;
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
  const warmed = useRef(new Set<string>());

  const templates = useMemo(
    () =>
      frames
        .map((f) => f.tileUrlTemplate)
        .filter((u): u is string => Boolean(u)),
    [frames],
  );

  useEffect(() => {
    if (!enabled || templates.length === 0) return;

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
      // Clamp to RainViewer native range; overzoom uses z12 tiles scaled up.
      const native = Math.max(3, Math.min(12, z));
      const levels = new Set<number>([
        native,
        Math.max(3, native - 1),
        Math.min(12, native + 1),
      ]);
      return [...levels];
    };

    const pushFrame = (idx: number, force = false) => {
      const tpl = templates[idx];
      if (!tpl) return;
      const zooms = zoomLevels();
      const cacheKey = `${tpl}|${zooms.join(",")}`;
      if (!force && warmed.current.has(cacheKey)) return;
      warmed.current.add(cacheKey);
      const bounds = viewportBounds();
      for (const url of radarWarmupTileUrls(tpl, zooms, bounds, 48)) {
        queue.push(url);
      }
    };

    const n = templates.length;
    // Current + next frames first (playback path), then a wider look-ahead.
    for (let step = 0; step <= 6; step++) {
      pushFrame((activeIndex + step) % n, step === 0);
    }
    pushFrame((activeIndex - 1 + n) % n);

    let active = 0;
    const CONCURRENCY = 16;
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

    // Re-warm when the user pans/zooms into a new viewport.
    let moveTimer: number | null = null;
    const onViewChange = () => {
      if (moveTimer != null) window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => {
        if (cancelled) return;
        pushFrame(activeIndex % n, true);
        pushFrame((activeIndex + 1) % n, true);
        pump();
      }, 120);
    };
    map.on("moveend", onViewChange);
    map.on("zoomend", onViewChange);

    return () => {
      cancelled = true;
      if (moveTimer != null) window.clearTimeout(moveTimer);
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
