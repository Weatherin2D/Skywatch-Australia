"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WeatherFrame } from "@/lib/weather/maps";

const PRELOAD_CONCURRENCY = 8;

/**
 * Preloads satellite frame images with limited concurrency so the browser
 * connection pool is not flooded. Reports which URLs are fully loaded.
 * Loads in playback order (oldest → newest) so autoplay from frame 0 stays smooth.
 */
export function useFramePreloader(frames: WeatherFrame[], enabled = true) {
  const [readyUrls, setReadyUrls] = useState<Set<string>>(() => new Set());
  const readyRef = useRef<Set<string>>(new Set());
  const framesKey = useMemo(
    () => frames.map((f) => f.imageUrl ?? "").join("|"),
    [frames],
  );

  useEffect(() => {
    if (!enabled) return;
    const urls = frames
      .map((f) => f.imageUrl)
      .filter((u): u is string => Boolean(u));
    if (urls.length === 0) return;

    let cancelled = false;
    let active = 0;
    const queue = urls.filter((u) => !readyRef.current.has(u));

    const markReady = (url: string) => {
      if (readyRef.current.has(url)) return;
      readyRef.current.add(url);
      setReadyUrls(new Set(readyRef.current));
    };

    const pump = () => {
      while (!cancelled && active < PRELOAD_CONCURRENCY && queue.length > 0) {
        const url = queue.shift()!;
        if (readyRef.current.has(url)) continue;
        active += 1;
        const img = new window.Image();
        img.decoding = "async";
        const done = () => {
          active -= 1;
          markReady(url);
          pump();
        };
        img.onload = () => {
          if (typeof img.decode === "function") {
            void img.decode().then(done).catch(done);
          } else {
            done();
          }
        };
        img.onerror = done;
        img.src = url;
      }
    };

    pump();
    return () => {
      cancelled = true;
    };
    // framesKey captures URL identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framesKey, enabled]);

  const total = frames.filter((f) => f.imageUrl).length;
  const readyCount = frames.reduce(
    (n, f) => n + (f.imageUrl && readyUrls.has(f.imageUrl) ? 1 : 0),
    0,
  );

  return {
    readyCount,
    total,
    allReady: total > 0 && readyCount >= total,
    isUrlReady: (url: string | null | undefined) =>
      Boolean(url && readyUrls.has(url)),
    isIndexReady: (index: number) => {
      const url = frames[index]?.imageUrl;
      return Boolean(url && readyUrls.has(url));
    },
  };
}
