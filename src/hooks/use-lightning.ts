"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LightningPayload, LightningStrike } from "@/lib/weather/lightning";

type State = {
  strikes: LightningStrike[];
  loading: boolean;
  error: string | null;
  generated: number | null;
  attribution: string | null;
  status: LightningPayload["status"] | null;
  live: boolean;
};

const EMPTY: State = {
  strikes: [],
  loading: false,
  error: null,
  generated: null,
  attribution: null,
  status: null,
  live: false,
};

const POLL_MS = 3000;

export function useLightning(enabled: boolean) {
  const [state, setState] = useState<State>(EMPTY);
  const seenRef = useRef<Map<string, LightningStrike>>(new Map());

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({
      ...s,
      loading: s.strikes.length === 0 && !s.live,
      error: null,
    }));
    try {
      const res = await fetch("/api/weather/lightning", {
        signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Lightning unavailable (${res.status})`);
      const data = (await res.json()) as LightningPayload;
      if (signal?.aborted) return;

      // Merge into a client-side rolling window so brief empty polls don't flash
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - (data.windowMinutes ?? 30) * 60;
      for (const strike of data.strikes) {
        seenRef.current.set(strike.id, strike);
      }
      for (const [id, strike] of seenRef.current) {
        if (strike.time < cutoff) seenRef.current.delete(id);
      }
      const merged = [...seenRef.current.values()].sort(
        (a, b) => b.time - a.time,
      );

      setState({
        strikes: merged,
        loading: false,
        error: null,
        generated: data.generated,
        attribution: data.attribution,
        status: data.status,
        live: data.status === "live" || data.status === "reconnecting",
      });
    } catch (err) {
      if (signal?.aborted) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Lightning unavailable",
        live: false,
      }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      seenRef.current.clear();
      setState(EMPTY);
      return;
    }
    const ac = new AbortController();
    void load(ac.signal);
    const id = window.setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [enabled, load]);

  return state;
}
