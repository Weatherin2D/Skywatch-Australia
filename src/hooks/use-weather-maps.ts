"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SATELLITE_PRODUCT,
  HIMAWARI_STEP_SEC,
  type SatelliteProductId,
  type WeatherFrame,
  type WeatherMapsPayload,
} from "@/lib/weather/maps";

type State = {
  data: WeatherMapsPayload | null;
  loading: boolean;
  error: string | null;
  /** Unix seconds of the newest satellite tip the last time the tip advanced. */
  lastTipAt: number | null;
  /** Wall-clock ms when we first saw the current tip (for live UI). */
  tipSeenAtMs: number | null;
};

/** Stable empty list — avoid `?? []` allocating a new array every render. */
const EMPTY_FRAMES: WeatherFrame[] = [];

/** Himawari tips land ~10 min apart — polling every 45s burned Fluid CPU. */
const LIVE_POLL_MS = 90_000;
/**
 * RealEarth tips land ~15–30 min after the wall-clock slot. Nudge after each
 * 10-minute boundary, but with enough delay that we don't stack on the poll.
 */
const BOUNDARY_OFFSET_MS = 90_000;

function msUntilNextTenMinuteBoundary(now = Date.now()): number {
  const stepMs = HIMAWARI_STEP_SEC * 1000;
  const next = Math.ceil((now + 1) / stepMs) * stepMs;
  return Math.max(30_000, next - now + BOUNDARY_OFFSET_MS);
}

export function useWeatherMaps(
  product: SatelliteProductId = DEFAULT_SATELLITE_PRODUCT,
) {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
    lastTipAt: null,
    tipSeenAtMs: null,
  });
  const tipRef = useRef<number | null>(null);

  useEffect(() => {
    tipRef.current = null;
  }, [product]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    setState((s) => ({
      ...s,
      loading: s.data == null,
      error: null,
    }));
    try {
      // Product menu needs every loop — CDN Cache-Control absorbs repeats.
      const res = await fetch("/api/weather/maps?all=1", { signal });
      if (!res.ok) {
        throw new Error(`Weather maps unavailable (${res.status})`);
      }
      const data = (await res.json()) as WeatherMapsPayload;
      if (signal?.aborted) return;

      // Only use the selected product's tip — never fall back to another
      // product's frames (that made IR look like it "switched" to Air Mass).
      const tip =
        data.satellite.products?.[product]?.frames?.at(-1)?.time ??
        (data.satellite.product === product
          ? data.satellite.frames.at(-1)?.time
          : null) ??
        null;

      const tipAdvanced = tip != null && tip !== tipRef.current;
      if (tip != null) tipRef.current = tip;

      setState((s) => ({
        data,
        loading: false,
        error: null,
        lastTipAt: tip,
        tipSeenAtMs: tipAdvanced || s.tipSeenAtMs == null ? Date.now() : s.tipSeenAtMs,
      }));
    } catch (err) {
      if (signal?.aborted) return;
      const message =
        err instanceof Error ? err.message : "Satellite loop unavailable";
      setState((s) => ({
        ...s,
        data: s.data,
        loading: false,
        error: message,
      }));
    }
  }, [product]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);

    const intervalId = window.setInterval(() => {
      void load();
    }, LIVE_POLL_MS);

    let boundaryTimer = 0;
    const scheduleBoundary = () => {
      boundaryTimer = window.setTimeout(() => {
        void load();
        scheduleBoundary();
      }, msUntilNextTenMinuteBoundary());
    };
    scheduleBoundary();

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ac.abort();
      window.clearInterval(intervalId);
      window.clearTimeout(boundaryTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const satelliteFrames: WeatherFrame[] =
    state.data?.satellite.products?.[product]?.frames ??
    (state.data?.satellite.product === product
      ? state.data.satellite.frames
      : EMPTY_FRAMES);
  const radarFrames: WeatherFrame[] = state.data?.radar.past ?? EMPTY_FRAMES;

  return {
    ...state,
    product,
    satelliteFrames,
    radarFrames,
    satelliteSource: state.data?.satellite.source ?? null,
    products: state.data?.satellite.products ?? null,
    refetch: () => load(),
  };
}
