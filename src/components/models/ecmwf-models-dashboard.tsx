"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import {
  DEFAULT_MAP_SETTINGS,
  type MapSettingsState,
} from "@/components/home/mock-data";
import { SiteShell } from "@/components/site/site-shell";
import { cn } from "@/lib/utils";

const DEFAULT_PRODUCT_ID = "temperature_2m";
const MAP_BOUNDS: [[number, number], [number, number]] = [
  [-44.0, 112.5],
  [-9.5, 154.5],
];

type EcmwfProductGroup =
  | "surface"
  | "precip"
  | "cloud"
  | "wind"
  | "thermo"
  | "levels";

type EcmwfMapCatalog = {
  model: string;
  modelLabel: string;
  attribution: string;
  bounds: [[number, number], [number, number]];
  defaultProductId: string;
  products: {
    id: string;
    label: string;
    shortLabel: string;
    group: EcmwfProductGroup;
    groupLabel: string;
    units: string;
  }[];
  groups: { id: EcmwfProductGroup; label: string }[];
  times: string[];
  issuedAt: string | null;
};

const GROUP_LABELS: Record<EcmwfProductGroup, string> = {
  surface: "Surface",
  precip: "Precipitation",
  cloud: "Cloud",
  wind: "Wind",
  thermo: "Thermo",
  levels: "Pressure levels",
};

const MAP_SETTINGS: MapSettingsState = {
  ...DEFAULT_MAP_SETTINGS,
  outlines: true,
  stateOutlines: true,
  cityLabels: false,
  satelliteBasemap: false,
};

const GROUP_ORDER: EcmwfProductGroup[] = [
  "surface",
  "precip",
  "cloud",
  "wind",
  "thermo",
  "levels",
];

function formatHourLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);
}

function nearestTimeIndex(times: string[]): number {
  if (!times.length) return 0;
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]!);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - now);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

export function EcmwfModelsDashboard() {
  const [catalog, setCatalog] = useState<EcmwfMapCatalog | null>(null);
  const [productId, setProductId] = useState(DEFAULT_PRODUCT_ID);
  const [timeIndex, setTimeIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [frameLoading, setFrameLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<EcmwfProductGroup | "all">(
    "all",
  );

  const loadCatalog = useCallback(async (product: string, signal?: AbortSignal) => {
    setLoadingCatalog(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/weather/ecmwf-map?product=${encodeURIComponent(product)}`,
        { cache: "no-store", signal },
      );
      if (!res.ok) throw new Error(`Catalog unavailable (${res.status})`);
      const json = (await res.json()) as EcmwfMapCatalog;
      if (signal?.aborted) return;
      setCatalog(json);
      setTimeIndex((prev) => {
        if (!json.times.length) return 0;
        if (prev > 0 && prev < json.times.length) return prev;
        return nearestTimeIndex(json.times);
      });
      setLoadingCatalog(false);
    } catch (err) {
      if (signal?.aborted) return;
      setLoadingCatalog(false);
      setError(err instanceof Error ? err.message : "Unavailable");
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void loadCatalog(productId, ac.signal);
    return () => ac.abort();
  }, [productId, loadCatalog]);

  const times = catalog?.times ?? [];
  const activeTime = times[timeIndex] ?? null;

  const imageUrl = useMemo(() => {
    if (!activeTime) return null;
    const qs = new URLSearchParams({
      product: productId,
      time: activeTime,
    });
    return `/api/weather/ecmwf-map/frame?${qs}`;
  }, [productId, activeTime]);

  useEffect(() => {
    if (!imageUrl) return;
    setFrameLoading(true);
    const img = new Image();
    img.onload = () => setFrameLoading(false);
    img.onerror = () => setFrameLoading(false);
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    if (!playing || times.length < 2) return;
    const id = window.setInterval(() => {
      setTimeIndex((i) => (i + 1) % times.length);
    }, 700);
    return () => window.clearInterval(id);
  }, [playing, times.length]);

  const products = useMemo(() => {
    const list = catalog?.products ?? [];
    if (groupFilter === "all") return list;
    return list.filter((p) => p.group === groupFilter);
  }, [catalog, groupFilter]);

  const activeProduct = catalog?.products.find((p) => p.id === productId);

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[1600px] space-y-3 px-3 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              ECMWF IFS
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white sm:text-3xl">
              Models
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-white/70">
              Hourly ECMWF fields over Australia — pick a product and scrub the
              forecast like Windy.
            </p>
          </div>
          {catalog?.attribution ? (
            <p className="text-[10px] text-white/45">{catalog.attribution}</p>
          ) : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="sw-panel flex h-[min(70vh,720px)] flex-col overflow-hidden p-2">
            <div className="flex shrink-0 flex-wrap gap-1 border-b border-white/10 pb-2">
              <button
                type="button"
                onClick={() => setGroupFilter("all")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-semibold",
                  groupFilter === "all"
                    ? "bg-[var(--cyan)]/25 text-[var(--cyan)]"
                    : "text-white/55 hover:text-white",
                )}
              >
                All
              </button>
              {GROUP_ORDER.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupFilter(g)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-semibold",
                    groupFilter === g
                      ? "bg-[var(--cyan)]/25 text-[var(--cyan)]"
                      : "text-white/55 hover:text-white",
                  )}
                >
                  {GROUP_LABELS[g]}
                </button>
              ))}
            </div>
            <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
              {loadingCatalog && !catalog ? (
                <li className="px-2.5 py-2 text-xs text-white/55">
                  Loading products…
                </li>
              ) : null}
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setProductId(p.id);
                    }}
                    className={cn(
                      "flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition",
                      productId === p.id
                        ? "bg-white/12 text-white"
                        : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    <span className="text-sm font-semibold">{p.shortLabel}</span>
                    <span className="text-[10px] text-white/45">{p.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="min-w-0 space-y-2">
            <div className="relative h-[min(68vh,720px)] min-h-[360px] overflow-hidden rounded-xl border border-white/10">
              <HomeMapDynamic
                mode="Map"
                regionId="national"
                mapSettings={MAP_SETTINGS}
                riskImageUrl={imageUrl}
                riskImageBounds={catalog?.bounds ?? MAP_BOUNDS}
                riskImageDisplay="geo"
                riskImageOpacity={0.78}
              />
              {(loadingCatalog || frameLoading) && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] bg-gradient-to-b from-[#0a1224]/80 to-transparent px-3 py-2 text-xs font-semibold text-white/80">
                  Loading ECMWF {activeProduct?.shortLabel ?? "field"}…
                </div>
              )}
              {error ? (
                <div className="absolute inset-x-3 bottom-16 z-[500] rounded-lg border border-red-400/30 bg-[#0a1224]/90 px-3 py-2 text-sm text-white/90">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="sw-panel flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous hour"
                  className="rounded-lg border border-white/15 bg-white/[0.04] p-2 text-white/80 hover:text-white"
                  onClick={() => {
                    setPlaying(false);
                    setTimeIndex((i) => Math.max(0, i - 1));
                  }}
                  disabled={!times.length}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={playing ? "Pause" : "Play"}
                  className="rounded-lg border border-white/15 bg-white/[0.04] p-2 text-white/80 hover:text-white"
                  onClick={() => setPlaying((p) => !p)}
                  disabled={times.length < 2}
                >
                  {playing ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Next hour"
                  className="rounded-lg border border-white/15 bg-white/[0.04] p-2 text-white/80 hover:text-white"
                  onClick={() => {
                    setPlaying(false);
                    setTimeIndex((i) => Math.min(times.length - 1, i + 1));
                  }}
                  disabled={!times.length}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-white">
                    {activeTime ? formatHourLabel(activeTime) : "—"}
                    <span className="ml-2 text-xs font-normal text-white/50">
                      AEST/AEDT
                    </span>
                  </p>
                  <p className="text-xs text-white/55">
                    {activeProduct
                      ? `${activeProduct.label}${activeProduct.units ? ` (${activeProduct.units})` : ""}`
                      : ""}
                  </p>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, times.length - 1)}
                  value={timeIndex}
                  onChange={(e) => {
                    setPlaying(false);
                    setTimeIndex(Number(e.target.value));
                  }}
                  disabled={!times.length}
                  className="w-full accent-[var(--cyan)]"
                  aria-label="Forecast hour"
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </SiteShell>
  );
}
