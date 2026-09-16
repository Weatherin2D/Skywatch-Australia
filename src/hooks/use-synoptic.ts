"use client";

import { useCallback, useEffect, useState } from "react";
import type { SynopticFrame, SynopticPayload } from "@/lib/weather/synoptic";
import { pickSynopticFrame } from "@/lib/weather/synoptic";

type State = {
  frames: SynopticFrame[];
  latest: SynopticFrame | null;
  loading: boolean;
  error: string | null;
  attribution: string | null;
};

const EMPTY: State = {
  frames: [],
  latest: null,
  loading: false,
  error: null,
  attribution: null,
};

export function useSynoptic(enabled: boolean) {
  const [state, setState] = useState<State>(EMPTY);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({
      ...s,
      loading: s.frames.length === 0,
      error: null,
    }));
    try {
      const res = await fetch("/api/weather/synoptic", {
        signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Synoptic unavailable (${res.status})`);
      const data = (await res.json()) as SynopticPayload;
      if (signal?.aborted) return;
      setState({
        frames: data.frames,
        latest: data.latest,
        loading: false,
        error: null,
        attribution: data.attribution,
      });
    } catch (err) {
      if (signal?.aborted) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Synoptic unavailable",
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
    // Refresh catalog every 10 minutes (charts update ~6-hourly)
    const id = window.setInterval(() => {
      void load();
    }, 10 * 60_000);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [enabled, load]);

  return {
    ...state,
    pickFrame: (refUnix: number) => pickSynopticFrame(state.frames, refUnix),
  };
}
