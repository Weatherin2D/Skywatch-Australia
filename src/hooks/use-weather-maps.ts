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

/** Poll often enough to catch each new 10-minute Himawari publish promptly. */
const LIVE_POLL_MS = 45_000;
/**
 * RealEarth tips land ~15–30 min after the wall-clock slot. Also nudge shortly
 * after each 10-minute boundary so we don't wait a full poll interval.
 */
const BOUNDARY_OFFSET_MS = 30_000;

function msUntilNextTenMinuteBoundary(now = Date.now()): number {
  const stepMs = HIMAWARI_STEP_SEC * 1000;
  const next = Math.ceil((now + 1) / stepMs) * stepMs;
  return Math.max(5_000, next - now + BOUNDARY_OFFSET_MS);
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
    setState((s) => ({
      ...s,
      loading: s.data == null,
      error: null,
    }));
    try {
      const res = await fetch("/api/weather/maps?all=1", {
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Weather maps unavailable (${res.status})`);
      }
      const data = (await res.json()) as WeatherMapsPayload;
      if (signal?.aborted) return;

      const tip =
        data.satellite.products?.[product]?.frames?.at(-1)?.time ??
        (data.satellite.product === product
          ? data.satellite.frames.at(-1)?.time
          : null) ??
        data.satellite.frames.at(-1)?.time ??
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
      : []) ??
    [];
  const radarFrames: WeatherFrame[] = state.data?.radar.past ?? [];

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
