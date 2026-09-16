"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SATELLITE_PRODUCT,
  SATELLITE_PRODUCTS,
  type SatelliteProductId,
  type WeatherFrame,
  type WeatherMapsPayload,
} from "@/lib/weather/maps";

type State = {
  data: WeatherMapsPayload | null;
  loading: boolean;
  error: string | null;
};

function preloadFrameImages(frames: WeatherFrame[]) {
  for (const frame of frames) {
    if (!frame.imageUrl || typeof window === "undefined") continue;
    const img = new window.Image();
    img.decoding = "async";
    img.src = frame.imageUrl;
  }
}

export function useWeatherMaps(
  product: SatelliteProductId = DEFAULT_SATELLITE_PRODUCT,
) {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });
  const preloadedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Fetch every product in one parallel server pass for instant switching
      const res = await fetch("/api/weather/maps?all=1", {
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Weather maps unavailable (${res.status})`);
      }
      const data = (await res.json()) as WeatherMapsPayload;
      if (signal?.aborted) return;
      setState({ data, loading: false, error: null });

      // Warm the browser cache for all product frames in the background
      for (const meta of SATELLITE_PRODUCTS) {
        const frames = data.satellite.products?.[meta.id]?.frames ?? [];
        const key = `${meta.id}:${frames.map((f) => f.time).join(",")}`;
        if (preloadedRef.current.has(key)) continue;
        preloadedRef.current.add(key);
        preloadFrameImages(frames);
      }
    } catch (err) {
      if (signal?.aborted) return;
      const message =
        err instanceof Error ? err.message : "Satellite loop unavailable";
      setState({ data: null, loading: false, error: message });
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    const id = window.setInterval(() => {
      void load();
    }, 5 * 60 * 1000);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [load]);

  // Keep warming the active product when the selection changes
  useEffect(() => {
    const frames =
      state.data?.satellite.products?.[product]?.frames ??
      (state.data?.satellite.product === product
        ? state.data.satellite.frames
        : []) ??
      [];
    if (frames.length) preloadFrameImages(frames);
  }, [product, state.data]);

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
