"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import {
  RADAR_NATIVE_MAX_ZOOM,
  radarWarmupTileUrls,
} from "@/lib/weather/radar-palette";
import type { WeatherFrame } from "@/lib/weather/maps";

const TRANSPARENT_TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function createBufferLayer(zIndex: number): L.TileLayer {
  return L.tileLayer("", {
    opacity: 0,
    className: "skywatch-radar-tiles",
    // Keep the standard 256 CSS tile grid (matches basemap). The proxy serves
    // 512px PNGs into these slots for 2× supersampling / sharp retina paint.
    keepBuffer: 24,
    // Hold painted tiles through the gesture — updating mid-zoom was blanking
    // the radar so it looked like it "vanished" on pinch/scroll.
    updateWhenIdle: true,
    updateWhenZooming: false,
    updateInterval: 120,
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
}: {
  url: string | null;
  opacity?: number;
}) {
  const map = useMap();
  const buffersRef = useRef<[L.TileLayer, L.TileLayer] | null>(null);
  const frontRef = useRef(0);
  const displayedUrlRef = useRef<string | null>(null);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;

  useEffect(() => {
    const a = createBufferLayer(450);
    const b = createBufferLayer(451);
    buffersRef.current = [a, b];
    frontRef.current = 0;
    displayedUrlRef.current = null;
    a.addTo(map);
    b.addTo(map);

    const refreshFront = () => {
      const buffers = buffersRef.current;
      if (!buffers || !displayedUrlRef.current) return;
      const front = buffers[frontRef.current]!;
      front.redraw();
      front.setOpacity(opacityRef.current);
    };
    map.on("zoomend", refreshFront);
    map.on("moveend", refreshFront);

    return () => {
      map.off("zoomend", refreshFront);
      map.off("moveend", refreshFront);
      a.off();
      b.off();
      map.removeLayer(a);
      map.removeLayer(b);
      buffersRef.current = null;
      displayedUrlRef.current = null;
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
      displayedUrlRef.current = null;
      buffers[0]!.setOpacity(0);
      buffers[1]!.setOpacity(0);
      return;
    }

    if (url === displayedUrlRef.current) {
      buffers[frontRef.current]!.setOpacity(opacityRef.current);
      return;
    }

    const frontIdx = frontRef.current;
    const backIdx = 1 - frontIdx;
    const front = buffers[frontIdx]!;
    const back = buffers[backIdx]!;
    const hasPaintedFrame = Boolean(displayedUrlRef.current);

    if (hasPaintedFrame) {
      // Instant cut: load into the back buffer and reveal immediately — do not
      // wait for the Leaflet "load" event or any failsafe timeout.
      back.setUrl(url, false);
      back.setOpacity(opacityRef.current);
      back.setZIndex(451);
      front.setOpacity(0);
      front.setZIndex(450);
      frontRef.current = backIdx;
      displayedUrlRef.current = url;
      return;
    }

    // First paint — show as soon as the URL is set (no load wait).
    front.setUrl(url, false);
    front.setOpacity(opacityRef.current);
    front.setZIndex(451);
    back.setOpacity(0);
    back.setZIndex(450);
    frontRef.current = frontIdx;
    displayedUrlRef.current = url;
  }, [url, map]);

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
      if (!force && warmed.current.has(cacheKey)) return;
      warmed.current.add(cacheKey);
      const bounds = viewportBounds();
      const cap = zooms.includes(RADAR_NATIVE_MAX_ZOOM) ? 48 : 32;
      for (const url of radarWarmupTileUrls(tpl, zooms, bounds, cap)) {
        queue.push(url);
      }
    };

    const n = templates.length;
    // Warm current + neighbours so playback never stalls on cold tiles.
    for (const step of [0, 1, 2, 3, 4, n - 1]) {
      pushFrame((activeIndex + step) % n, step === 0);
    }

    let active = 0;
    const CONCURRENCY = 14;
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
      if (moveTimer != null) window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => {
        if (cancelled) return;
        pushFrame(activeIndex % n, true);
        pushFrame((activeIndex + 1) % n, true);
        pump();
      }, 100);
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
