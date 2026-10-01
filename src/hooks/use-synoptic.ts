"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  SynopticFrame,
  SynopticPayload,
} from "@/lib/weather/synoptic";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import { pickSynopticFrame } from "@/lib/weather/synoptic";
import { seedSynopticGeoJson } from "@/lib/weather/synoptic-geojson-cache";

type State = {
  frames: SynopticFrame[];
  latest: SynopticFrame | null;
  geojson: SynopticGeoJson | null;
  validTime: number | null;
  loading: boolean;
  error: string | null;
  attribution: string | null;
};

const EMPTY: State = {
  frames: [],
  latest: null,
  geojson: null,
  validTime: null,
  loading: false,
  error: null,
  attribution: null,
};

export function useSynoptic(enabled: boolean) {
  const [state, setState] = useState<State>(EMPTY);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({
      ...s,
      loading: s.geojson == null && s.frames.length === 0,
      error: null,
    }));
    try {
      let res: Response | null = null;
      let lastStatus = 0;
      // One retry covers Vercel cold-start races without blocking the UI long.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) return;
        res = await fetch("/api/weather/synoptic", {
          signal,
          cache: "no-store",
        });
        lastStatus = res.status;
        if (res.ok) break;
        if (res.status !== 502 && res.status !== 503 && res.status !== 504) break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
      if (!res || !res.ok) {
        throw new Error(`Synoptic unavailable (${lastStatus || "network"})`);
      }
      const data = (await res.json()) as SynopticPayload;
      if (signal?.aborted) return;
      if (data.geojson && data.latest?.geojsonUrl) {
        seedSynopticGeoJson(data.latest.geojsonUrl, data.geojson);
      }
      setState({
        frames: data.frames,
        latest: data.latest,
        geojson: data.geojson,
        validTime: data.validTime,
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
    const id = window.setInterval(() => {
      void load();
    }, 5 * 60_000);
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
