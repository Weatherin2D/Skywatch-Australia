"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startClientLightningFeed } from "@/lib/weather/blitzortung-client";
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

/** HTTP backfill only — live strikes come from the browser WebSocket feed. */
const POLL_MS = 20_000;
/** Even slower once the live client socket is delivering strikes. */
const POLL_MS_WHEN_LIVE = 60_000;
const WINDOW_MIN = 24 * 60;

function mergeStrike(
  map: Map<string, LightningStrike>,
  strike: LightningStrike,
) {
  map.set(strike.id, strike);
}

function pruneMap(map: Map<string, LightningStrike>, nowSec: number) {
  const cutoff = nowSec - WINDOW_MIN * 60;
  for (const [id, strike] of map) {
    if (strike.time < cutoff) map.delete(id);
  }
}

export function useLightning(enabled: boolean) {
  const [state, setState] = useState<State>(EMPTY);
  const seenRef = useRef(new Map<string, LightningStrike>());
  const liveRef = useRef(false);

  const publish = useCallback(
    (
      patch: Partial<State> & {
        keepStrikes?: boolean;
      } = {},
    ) => {
      const now = Math.floor(Date.now() / 1000);
      pruneMap(seenRef.current, now);
      const merged = [...seenRef.current.values()].sort(
        (a, b) => b.time - a.time,
      );
      const live = patch.live ?? liveRef.current;
      liveRef.current = Boolean(live);
      setState((s) => ({
        strikes: merged,
        loading: false,
        error: patch.error ?? null,
        generated: patch.generated ?? s.generated ?? now,
        attribution: patch.attribution ?? s.attribution,
        status: patch.status ?? s.status,
        live,
      }));
    },
    [],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      setState((s) => ({
        ...s,
        loading: s.strikes.length === 0 && !s.live,
        error: null,
      }));
      try {
        const res = await fetch("/api/weather/lightning", {
          signal,
          // Respect short Cache-Control from the API.
        });
        if (!res.ok) throw new Error(`Lightning unavailable (${res.status})`);
        const data = (await res.json()) as LightningPayload;
        if (signal?.aborted) return;

        for (const strike of data.strikes) {
          mergeStrike(seenRef.current, strike);
        }
        publish({
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
          live: s.live,
        }));
      }
    },
    [publish],
  );

  useEffect(() => {
    if (!enabled) {
      seenRef.current.clear();
      liveRef.current = false;
      setState(EMPTY);
      return;
    }

    const ac = new AbortController();
    void load(ac.signal);

    let id = 0;
    const schedule = () => {
      window.clearInterval(id);
      const ms = liveRef.current ? POLL_MS_WHEN_LIVE : POLL_MS;
      id = window.setInterval(() => {
        void load();
      }, ms);
    };
    schedule();
    // Re-tune interval when live flag flips via socket.
    const retune = window.setInterval(schedule, 15_000);

    const client = startClientLightningFeed((strike) => {
      mergeStrike(seenRef.current, strike);
      publish({
        status: "live",
        live: true,
        attribution:
          "Lightning © Blitzortung.org / LightningMaps.org (CC BY-SA)",
      });
    });

    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      ac.abort();
      window.clearInterval(id);
      window.clearInterval(retune);
      document.removeEventListener("visibilitychange", onVis);
      client.stop();
    };
  }, [enabled, load, publish]);

  return state;
}
