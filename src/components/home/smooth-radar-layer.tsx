"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TileLayer, useMap } from "react-leaflet";
import { radarWarmupTileUrls } from "@/lib/weather/radar-palette";
import type { WeatherFrame } from "@/lib/weather/maps";

/**
 * Dual-buffer radar TileLayer: keep the previous frame visible until the next
 * frame's visible tiles have loaded, then crossfade. Avoids blank flashes.
 */
export function SmoothRadarLayer({
  url,
  opacity = 0.88,
}: {
  url: string | null;
  opacity?: number;
}) {
  const [shown, setShown] = useState<string | null>(url);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);
  const fadeTimer = useRef<number>(0);

  // Always chase the latest requested URL; keep `shown` until that URL's
  // visible tiles report load so playback never blanks the map.
  useEffect(() => {
    if (!url) {
      setShown(null);
      setIncoming(null);
      setIncomingReady(false);
      return;
    }
    if (url === shown) {
      setIncoming(null);
      setIncomingReady(false);
      return;
    }
    if (!shown) {
      setShown(url);
      return;
    }
    if (url !== incoming) {
      setIncoming(url);
      setIncomingReady(false);
    }
  }, [url, shown, incoming]);

  useEffect(() => {
    if (!incoming || !incomingReady) return;
    window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => {
      setShown(incoming);
      setIncoming(null);
      setIncomingReady(false);
    }, 30);
    return () => window.clearTimeout(fadeTimer.current);
  }, [incoming, incomingReady]);

  if (!shown && !incoming) return null;

  return (
    <>
      {shown ? (
        <TileLayer
          key={`radar-a-${shown}`}
          url={shown}
          opacity={opacity}
          className="skywatch-radar-tiles"
          keepBuffer={6}
          updateWhenIdle={false}
          updateWhenZooming={false}
          zIndex={450}
        />
      ) : null}
      {incoming ? (
        <TileLayer
          key={`radar-b-${incoming}`}
          url={incoming}
          opacity={incomingReady ? opacity : 0.01}
          className="skywatch-radar-tiles"
          keepBuffer={6}
          updateWhenIdle={false}
          updateWhenZooming={false}
          zIndex={451}
          eventHandlers={{
            load: () => setIncomingReady(true),
          }}
        />
      ) : null}
    </>
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
    const pushFrame = (idx: number) => {
      const tpl = templates[idx];
      if (!tpl || warmed.current.has(tpl)) return;
      warmed.current.add(tpl);
      // Prefer current map zoom band + national warm set.
      let z = 4;
      try {
        z = Math.max(3, Math.min(7, Math.round(map.getZoom())));
      } catch {
        /* map may be tearing down */
      }
      for (const url of radarWarmupTileUrls(tpl, [z, Math.max(3, z - 1)])) {
        queue.push(url);
      }
    };

    // Warm active + next few + a couple behind (loop wrap).
    const n = templates.length;
    for (let step = 0; step <= 4; step++) {
      pushFrame((activeIndex + step) % n);
    }
    pushFrame((activeIndex - 1 + n) % n);

    let active = 0;
    const CONCURRENCY = 10;
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

    return () => {
      cancelled = true;
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
