"use client";

import { useCallback, useEffect, useState } from "react";
import type { CapitalSnapshot } from "@/lib/weather/location-forecast";

type Payload = {
  generated: string;
  capitals: CapitalSnapshot[];
  attribution: string;
};

type State = {
  data: Payload | null;
  loading: boolean;
  error: string | null;
};

export function useCapitals(refreshMs = 5 * 60_000) {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({
      ...s,
      loading: s.data == null,
      error: null,
    }));
    try {
      const res = await fetch("/api/weather/capitals", { signal });
      if (!res.ok) throw new Error(`Capitals unavailable (${res.status})`);
      const data = (await res.json()) as Payload;
      if (signal?.aborted) return;
      setState({ data, loading: false, error: null });
    } catch (err) {
      if (signal?.aborted) return;
      const message =
        err instanceof Error ? err.message : "Capitals unavailable";
      setState((s) => ({
        data: s.data,
        loading: false,
        error: message,
      }));
    }
  }, []);

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
    capitals: state.data?.capitals ?? [],
    reload: () => load(),
  };
}
