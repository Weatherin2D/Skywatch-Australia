"use client";

import { useCallback, useEffect, useState } from "react";
import type { LightningPayload, LightningStrike } from "@/lib/weather/lightning";

type State = {
  strikes: LightningStrike[];
  loading: boolean;
  error: string | null;
  generated: number | null;
  attribution: string | null;
};

const EMPTY: State = {
  strikes: [],
  loading: false,
  error: null,
  generated: null,
  attribution: null,
};

export function useLightning(enabled: boolean) {
  const [state, setState] = useState<State>(EMPTY);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({ ...s, loading: s.strikes.length === 0, error: null }));
    try {
      const res = await fetch("/api/weather/lightning", {
        signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Lightning unavailable (${res.status})`);
      const data = (await res.json()) as LightningPayload;
      if (signal?.aborted) return;
      setState({
        strikes: data.strikes,
        loading: false,
        error: null,
        generated: data.generated,
        attribution: data.attribution,
      });
    } catch (err) {
      if (signal?.aborted) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Lightning unavailable",
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
    }, 12_000);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [enabled, load]);

  return state;
}
