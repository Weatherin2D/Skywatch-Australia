"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WeatherFrame } from "@/lib/weather/maps";

/** Keep browser + Fluid CPU calm — tip-first order still warms playback. */
const PRELOAD_CONCURRENCY = 3;

/**
 * Preloads satellite frame images with limited concurrency so the browser
 * connection pool is not flooded. Reports which URLs are fully loaded.
 * Loads in playback order (oldest → newest) so autoplay from frame 0 stays smooth.
 *
 * Failed URLs are marked "settled" so the loop can skip them instead of freezing.
 */
export function useFramePreloader(frames: WeatherFrame[], enabled = true) {
  const [readyUrls, setReadyUrls] = useState<Set<string>>(() => new Set());
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const readyRef = useRef<Set<string>>(new Set());
  const failedRef = useRef<Set<string>>(new Set());
  const framesRef = useRef(frames);
  framesRef.current = frames;

  const framesKey = useMemo(
    () => frames.map((f) => f.imageUrl ?? "").join("|"),
    [frames],
  );

  // Reset settled sets when the loop identity changes (product / region / tip).
  useEffect(() => {
    readyRef.current = new Set();
    failedRef.current = new Set();
    setReadyUrls(new Set());
    setFailedUrls(new Set());
  }, [framesKey]);

  useEffect(() => {
    if (!enabled) return;
    const urls = frames
      .map((f) => f.imageUrl)
      .filter((u): u is string => Boolean(u));
    if (urls.length === 0) return;

    let cancelled = false;
    let active = 0;
    const queue = urls.filter(
      (u) => !readyRef.current.has(u) && !failedRef.current.has(u),
    );

    const markReady = (url: string) => {
      if (readyRef.current.has(url) || failedRef.current.has(url)) return;
      readyRef.current.add(url);
      setReadyUrls(new Set(readyRef.current));
    };

    const markFailed = (url: string) => {
      if (readyRef.current.has(url) || failedRef.current.has(url)) return;
      failedRef.current.add(url);
      setFailedUrls(new Set(failedRef.current));
    };

    const pump = () => {
      while (!cancelled && active < PRELOAD_CONCURRENCY && queue.length > 0) {
        const url = queue.shift()!;
        if (readyRef.current.has(url) || failedRef.current.has(url)) continue;
        active += 1;
        const img = new window.Image();
        img.decoding = "async";
        const doneOk = () => {
          active -= 1;
          markReady(url);
          pump();
        };
        const doneFail = () => {
          active -= 1;
          markFailed(url);
          pump();
        };
        img.onload = () => {
          if (typeof img.decode === "function") {
            void img.decode().then(doneOk).catch(doneOk);
          } else {
            doneOk();
          }
        };
        img.onerror = doneFail;
        img.src = url;
      }
    };

    pump();
    return () => {
      cancelled = true;
    };
  }, [framesKey, enabled, frames]);

  const total = frames.filter((f) => f.imageUrl).length;
  const readyCount = frames.reduce(
    (n, f) => n + (f.imageUrl && readyUrls.has(f.imageUrl) ? 1 : 0),
    0,
  );
  const settledCount = frames.reduce(
    (n, f) =>
      n +
      (f.imageUrl &&
      (readyUrls.has(f.imageUrl) || failedUrls.has(f.imageUrl))
        ? 1
        : 0),
    0,
  );

  // Stable callbacks — playback interval must not restart on every settle.
  const isIndexReady = useCallback((index: number) => {
    const url = framesRef.current[index]?.imageUrl;
    return Boolean(url && readyRef.current.has(url));
  }, []);

  const isIndexSettled = useCallback((index: number) => {
    const url = framesRef.current[index]?.imageUrl;
    if (!url) return true;
    return readyRef.current.has(url) || failedRef.current.has(url);
  }, []);

  const isUrlReady = useCallback(
    (url: string | null | undefined) =>
      Boolean(url && readyRef.current.has(url)),
    [],
  );

  return {
    readyCount,
    total,
    settledCount,
    allReady: total > 0 && readyCount >= total,
    allSettled: total > 0 && settledCount >= total,
    isUrlReady,
    isIndexReady,
    isIndexSettled,
  };
}
