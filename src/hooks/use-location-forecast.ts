"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocationForecastPayload } from "@/lib/weather/location-forecast";

type State = {
  data: LocationForecastPayload | null;
  loading: boolean;
  error: string | null;
};

export function useLocationForecast(
  geohash: string | null,
  refreshMs = 5 * 60_000,
) {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!geohash) {
        setState({ data: null, loading: false, error: null });
        return;
      }
      setState((s) => ({
        ...s,
        loading: s.data == null,
        error: null,
      }));
      try {
        const res = await fetch(
          `/api/weather/forecast/${encodeURIComponent(geohash)}`,
          { signal },
        );
        if (!res.ok) {
          throw new Error(`Forecast unavailable (${res.status})`);
        }
        const data = (await res.json()) as LocationForecastPayload;
        if (signal?.aborted) return;
        setState({ data, loading: false, error: null });
      } catch (err) {
        if (signal?.aborted) return;
        const message =
          err instanceof Error ? err.message : "Forecast unavailable";
        setState((s) => ({
          data: s.data,
          loading: false,
          error: message,
        }));
      }
    },
    [geohash],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    const id = window.setInterval(() => {
      void load();
    }, refreshMs);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return {
    ...state,
    forecast: state.data,
    reload: () => load(),
  };
}
