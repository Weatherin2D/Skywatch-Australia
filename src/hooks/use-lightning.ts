"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startClientLightningFeed } from "@/lib/weather/blitzortung-client";
import {
  LIGHTNING_CLIENT_MAX_STRIKES,
  sampleStrikesAcrossTime,
  type LightningPayload,
  type LightningStrike,
} from "@/lib/weather/lightning";

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

/** Keep the client map small, time-diverse, and spatially fair. */
function capMap(map: Map<string, LightningStrike>) {
  if (map.size <= LIGHTNING_CLIENT_MAX_STRIKES) return;
  const kept = sampleStrikesAcrossTime(
    [...map.values()],
    LIGHTNING_CLIENT_MAX_STRIKES,
  );
  map.clear();
  for (const strike of kept) map.set(strike.id, strike);
}

export function useLightning(enabled: boolean) {
  const [state, setState] = useState<State>(EMPTY);
  const seenRef = useRef(new Map<string, LightningStrike>());
  const liveRef = useRef(false);
  const publishRafRef = useRef(0);
  const pendingPatchRef = useRef<Partial<State> | null>(null);

  const flushPublish = useCallback(() => {
    publishRafRef.current = 0;
    const patch = pendingPatchRef.current ?? {};
    pendingPatchRef.current = null;

    const now = Math.floor(Date.now() / 1000);
    pruneMap(seenRef.current, now);
    capMap(seenRef.current);
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
  }, []);

  /** Coalesce rapid socket hits into one rAF publish — avoids main-thread lockups. */
  const publish = useCallback(
    (patch: Partial<State> = {}) => {
      pendingPatchRef.current = {
        ...(pendingPatchRef.current ?? {}),
        ...patch,
      };
      if (publishRafRef.current) return;
      publishRafRef.current = requestAnimationFrame(flushPublish);
    },
    [flushPublish],
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
        // Immediate flush after HTTP so the first paint isn't waiting on rAF alone.
        pendingPatchRef.current = {
          generated: data.generated,
          attribution: data.attribution,
          status: data.status,
          live: data.status === "live" || data.status === "reconnecting",
        };
        if (publishRafRef.current) {
          cancelAnimationFrame(publishRafRef.current);
          publishRafRef.current = 0;
        }
        flushPublish();
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
    [flushPublish],
  );

  useEffect(() => {
    if (!enabled) {
      seenRef.current.clear();
      liveRef.current = false;
      pendingPatchRef.current = null;
      if (publishRafRef.current) {
        cancelAnimationFrame(publishRafRef.current);
        publishRafRef.current = 0;
      }
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
      if (publishRafRef.current) {
        cancelAnimationFrame(publishRafRef.current);
        publishRafRef.current = 0;
      }
    };
  }, [enabled, load, publish]);

  return state;
}
