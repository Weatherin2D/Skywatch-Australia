"use client";

import { useCallback, useEffect, useState } from "react";
import type { WeatherFrame, WeatherMapsPayload } from "@/lib/weather/maps";

type State = {
  data: WeatherMapsPayload | null;
  loading: boolean;
  error: string | null;
};

export function useWeatherMaps() {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch("/api/weather/maps", {
        signal,
        cache: "no-store",
      });
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

  const satelliteFrames: WeatherFrame[] =
    state.data?.satellite.infrared ?? [];
  const radarFrames: WeatherFrame[] = state.data?.radar.past ?? [];

  return {
    ...state,
    satelliteFrames,
    radarFrames,
    satelliteSource: state.data?.satellite.source ?? null,
    refetch: () => load(),
  };
}
