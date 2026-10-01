"use client";

import { useCallback, useEffect, useState } from "react";
import type { BomWarningSummary } from "@/lib/weather/warnings";

export type WarningsListPayload = {
  generated: string;
  count: number;
  activeCount: number;
  states: string[];
  warnings: BomWarningSummary[];
  attribution: string;
};

type State = {
  data: WarningsListPayload | null;
  loading: boolean;
  error: string | null;
};

export function useWarnings(refreshMs = 60_000) {
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
      const res = await fetch("/api/weather/warnings", {
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Warnings unavailable (${res.status})`);
      }
      const data = (await res.json()) as WarningsListPayload;
      if (signal?.aborted) return;
      setState({ data, loading: false, error: null });
    } catch (err) {
      if (signal?.aborted) return;
      const message =
        err instanceof Error ? err.message : "Warnings unavailable";
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
    warnings: state.data?.warnings ?? [],
    states: state.data?.states ?? [],
    activeCount: state.data?.activeCount ?? 0,
    reload: () => load(),
  };
}
