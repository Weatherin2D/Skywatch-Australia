"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SATELLITE_PRODUCT,
  type SatelliteProductId,
  type WeatherFrame,
  type WeatherMapsPayload,
} from "@/lib/weather/maps";

type State = {
  data: WeatherMapsPayload | null;
  loading: boolean;
  error: string | null;
};

export function useWeatherMaps(
  product: SatelliteProductId = DEFAULT_SATELLITE_PRODUCT,
) {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetch(
          `/api/weather/maps?product=${encodeURIComponent(product)}`,
          {
            signal,
            cache: "no-store",
          },
        );
        if (!res.ok) {
          throw new Error(`Weather maps unavailable (${res.status})`);
        }
        const data = (await res.json()) as WeatherMapsPayload;
        if (signal?.aborted) return;
        setState({ data, loading: false, error: null });
      } catch (err) {
        if (signal?.aborted) return;
        const message =
          err instanceof Error ? err.message : "Satellite loop unavailable";
        setState({ data: null, loading: false, error: message });
      }
    },
    [product],
  );

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

  const satelliteFrames: WeatherFrame[] =
    state.data?.satellite.frames ??
    state.data?.satellite.products?.[product]?.frames ??
    [];
  const radarFrames: WeatherFrame[] = state.data?.radar.past ?? [];

  return {
    ...state,
    product,
    satelliteFrames,
    radarFrames,
    satelliteSource: state.data?.satellite.source ?? null,
    refetch: () => load(),
  };
}
