"use client";

import { useCallback, useEffect, useState } from "react";
import type { StationsPayload, WeatherStation } from "@/lib/weather/stations";

type State = {
  stations: WeatherStation[];
  loading: boolean;
  error: string | null;
  updatedAt: string | null;
  attribution: string | null;
};

const EMPTY: State = {
  stations: [],
  loading: false,
  error: null,
  updatedAt: null,
  attribution: null,
};

export function useStations(enabled: boolean) {
  const [state, setState] = useState<State>(EMPTY);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({
      ...s,
      loading: s.stations.length === 0,
      error: null,
    }));
    try {
      const res = await fetch("/api/weather/stations", {
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Stations unavailable (${res.status})`);
      }
      const data = (await res.json()) as StationsPayload;
      if (signal?.aborted) return;
      setState({
        stations: Array.isArray(data.stations) ? data.stations : [],
        loading: false,
        error: null,
        updatedAt: data.updatedAt ?? null,
        attribution: data.attribution ?? null,
      });
    } catch (err) {
      if (signal?.aborted) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Stations unavailable",
      }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    const ac = new AbortController();
    void load(ac.signal);
    const id = window.setInterval(() => {
      void load();
    }, 3 * 60_000);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [enabled, load]);

  return state;
}
