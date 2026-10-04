"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StormCellsPayload } from "@/lib/weather/storm-cell-types";

export function useStormCells(refreshMs = 45_000, enabled = true) {
  const [data, setData] = useState<StormCellsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setLoading(false);
        return;
      }
      setLoading(!hasDataRef.current);
      setError(null);
      try {
        const res = await fetch("/api/weather/storm-cells", {
          cache: "no-store",
          signal,
        });
        if (!res.ok) throw new Error(`Storm cells unavailable (${res.status})`);
        const json = (await res.json()) as StormCellsPayload;
        if (signal?.aborted) return;
        hasDataRef.current = true;
        setData(json);
        setLoading(false);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Unavailable");
        setLoading(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    if (!refreshMs || !enabled) return () => ac.abort();
    const id = window.setInterval(() => void load(), refreshMs);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [load, refreshMs, enabled]);

  return { data, loading, error, reload: () => load() };
}
