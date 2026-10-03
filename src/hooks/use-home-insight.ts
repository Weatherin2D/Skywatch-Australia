"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StormActivityPayload } from "@/lib/weather/storm-activity";
import type { ModelComparisonPayload } from "@/lib/weather/models";
import type { UpperAirPayload } from "@/lib/weather/upper-air";

function useJsonResource<T>(url: string | null, refreshMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!url) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(!hasDataRef.current);
      setError(null);
      try {
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          return;
        }
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as T;
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
    [url],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    if (!refreshMs) return () => ac.abort();
    const id = window.setInterval(() => void load(), refreshMs);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { data, loading, error, reload: () => load() };
}

export function useStormActivity(refreshMs = 90_000) {
  return useJsonResource<StormActivityPayload>(
    "/api/weather/storm-activity",
    refreshMs,
  );
}

export function useModelComparison(
  lat = -33.87,
  lon = 151.21,
  place = "Sydney",
  refreshMs = 10 * 60_000,
) {
  const url = `/api/weather/models?lat=${lat}&lon=${lon}&place=${encodeURIComponent(place)}`;
  return useJsonResource<ModelComparisonPayload>(url, refreshMs);
}

export function useUpperAir(
  lat = -33.87,
  lon = 151.21,
  place = "Sydney",
  refreshMs = 10 * 60_000,
) {
  const url = `/api/weather/upper-air?lat=${lat}&lon=${lon}&place=${encodeURIComponent(place)}`;
  return useJsonResource<UpperAirPayload>(url, refreshMs);
}
