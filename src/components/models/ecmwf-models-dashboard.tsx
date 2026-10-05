"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Link2,
  Pause,
  Play,
  Share2,
} from "lucide-react";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import {
  DEFAULT_MAP_SETTINGS,
  type MapSettingsState,
} from "@/components/home/mock-data";
import { ModelsCrossSectionPanel } from "@/components/models/models-cross-section-panel";
import { ModelsMeteogram } from "@/components/models/models-meteogram";
import { ModelsMiniSounding } from "@/components/models/models-mini-sounding";
import { SiteShell } from "@/components/site/site-shell";
import { useSavedPlace } from "@/hooks/use-saved-place";
import type { CrossSectionPayload } from "@/lib/weather/cross-section";
import { replaceUrlIfOnPath } from "@/lib/nav/safe-history";
import { absoluteAppUrl, shareContent } from "@/lib/share";
import type { SoundingPayload } from "@/lib/weather/sounding-types";
import { cn } from "@/lib/utils";

const DEFAULT_PRODUCT_ID = "temperature_2m";
const DEFAULT_MODEL_ID = "ecmwf";
const MAP_BOUNDS: [[number, number], [number, number]] = [
  [-44.0, 112.5],
  [-9.5, 154.5],
];

type MapModelId = "ecmwf" | "icon" | "gfs";

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
  defaultModelId: MapModelId;
  models: { id: MapModelId; label: string }[];
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

const FALLBACK_MODELS: { id: MapModelId; label: string }[] = [
  { id: "ecmwf", label: "ECMWF" },
  { id: "icon", label: "ICON" },
  { id: "gfs", label: "GFS" },
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

type ProbeSample = {
  lat: number;
  lon: number;
  time: string | null;
  productId: string;
  label: string;
  units: string;
  value: number | null;
  formatted: string;
};

type MeteogramSeries = {
  times: string[];
  values: (number | null)[];
  units: string;
  label: string;
};

function readModelsQuery(): {
  product: string;
  model: MapModelId;
  diff: MapModelId | null;
  time: string | null;
  lat: number | null;
  lon: number | null;
  skewt: boolean;
  transect: boolean;
} {
  if (typeof window === "undefined") {
    return {
      product: DEFAULT_PRODUCT_ID,
      model: DEFAULT_MODEL_ID,
      diff: null,
      time: null,
      lat: null,
      lon: null,
      skewt: false,
      transect: false,
    };
  }
  const sp = new URLSearchParams(window.location.search);
  const modelRaw = sp.get("model") || DEFAULT_MODEL_ID;
  const model: MapModelId =
    modelRaw === "icon" || modelRaw === "gfs" || modelRaw === "ecmwf"
      ? modelRaw
      : DEFAULT_MODEL_ID;
  const diffRaw = sp.get("diff");
  const diff: MapModelId | null =
    diffRaw === "icon" || diffRaw === "gfs" || diffRaw === "ecmwf"
      ? diffRaw
      : null;
  return {
    product: sp.get("product") || DEFAULT_PRODUCT_ID,
    model,
    diff: diff && diff !== model ? diff : null,
    time: sp.get("time"),
    lat: sp.get("lat") != null ? Number(sp.get("lat")) : null,
    lon: sp.get("lon") != null ? Number(sp.get("lon")) : null,
    skewt: sp.get("skewt") === "1",
    transect: sp.get("transect") === "1",
  };
}

function mapModelToSounding(model: MapModelId): string {
  if (model === "icon") return "pulse";
  if (model === "gfs") return "pulse";
  return "ifs";
}

export function EcmwfModelsDashboard() {
  const initial = useMemo(() => readModelsQuery(), []);
  const pathname = usePathname();
  const { place } = useSavedPlace();
  const [catalog, setCatalog] = useState<EcmwfMapCatalog | null>(null);
  const [productId, setProductId] = useState(initial.product);
  const [modelId, setModelId] = useState<MapModelId>(initial.model);
  const [diffModelId, setDiffModelId] = useState<MapModelId | null>(
    initial.diff,
  );
  const [timeIndex, setTimeIndex] = useState(0);
  const [preferredTime, setPreferredTime] = useState<string | null>(
    initial.time,
  );
  const [urlReady, setUrlReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [frameLoading, setFrameLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<EcmwfProductGroup | "all">(
    "all",
  );
  const [probe, setProbe] = useState<{
    lat: number;
    lng: number;
  } | null>(() =>
    initial.lat != null &&
    initial.lon != null &&
    Number.isFinite(initial.lat) &&
    Number.isFinite(initial.lon)
      ? { lat: initial.lat, lng: initial.lon }
      : null,
  );
  const [probeB, setProbeB] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [probeSample, setProbeSample] = useState<ProbeSample | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied">(
    "idle",
  );
  const [showSkewt, setShowSkewt] = useState(initial.skewt);
  const [transectMode, setTransectMode] = useState(initial.transect);
  const [sounding, setSounding] = useState<SoundingPayload | null>(null);
  const [soundingLoading, setSoundingLoading] = useState(false);
  const [soundingError, setSoundingError] = useState<string | null>(null);
  const [meteogram, setMeteogram] = useState<MeteogramSeries | null>(null);
  const [xsec, setXsec] = useState<CrossSectionPayload | null>(null);
  const [xsecLoading, setXsecLoading] = useState(false);
  const [xsecError, setXsecError] = useState<string | null>(null);

  const loadCatalog = useCallback(
    async (product: string, model: MapModelId, signal?: AbortSignal) => {
      setLoadingCatalog(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          product,
          model,
        });
        const res = await fetch(`/api/weather/ecmwf-map?${qs}`, {
          cache: "no-store",
          signal,
        });
        if (!res.ok) throw new Error(`Catalog unavailable (${res.status})`);
        const json = (await res.json()) as EcmwfMapCatalog;
        if (signal?.aborted) return;
        setCatalog(json);
        setTimeIndex(() => {
          if (!json.times.length) return 0;
          if (preferredTime) {
            const exact = json.times.indexOf(preferredTime);
            if (exact >= 0) return exact;
            return nearestTimeIndex(json.times);
          }
          return nearestTimeIndex(json.times);
        });
        setUrlReady(true);
        setLoadingCatalog(false);
      } catch (err) {
        if (signal?.aborted) return;
        setLoadingCatalog(false);
        setError(err instanceof Error ? err.message : "Unavailable");
      }
    },
    [preferredTime],
  );

  useEffect(() => {
    const ac = new AbortController();
    void loadCatalog(productId, modelId, ac.signal);
    return () => ac.abort();
  }, [productId, modelId, loadCatalog]);

  const times = catalog?.times ?? [];
  const activeTime = times[timeIndex] ?? null;
  const models = catalog?.models?.length ? catalog.models : FALLBACK_MODELS;

  // Shareable query sync — only while still on /models. Without this guard,
  // async catalog/frame updates could replaceState back to /models after the
  // user clicked Warnings/Radar/etc. and make those nav buttons look broken.
  useEffect(() => {
    if (!urlReady || typeof window === "undefined") return;
    if (pathname !== "/models") return;
    const params = new URLSearchParams();
    if (productId !== DEFAULT_PRODUCT_ID) params.set("product", productId);
    if (modelId !== DEFAULT_MODEL_ID) params.set("model", modelId);
    if (diffModelId && diffModelId !== modelId) params.set("diff", diffModelId);
    if (activeTime) params.set("time", activeTime);
    if (probe) {
      params.set("lat", probe.lat.toFixed(3));
      params.set("lon", probe.lng.toFixed(3));
    }
    if (showSkewt) params.set("skewt", "1");
    if (transectMode) params.set("transect", "1");
    const qs = params.toString();
    const next = qs ? `/models?${qs}` : "/models";
    replaceUrlIfOnPath("/models", next);
  }, [
    urlReady,
    pathname,
    productId,
    modelId,
    diffModelId,
    activeTime,
    probe,
    showSkewt,
    transectMode,
  ]);

  const imageUrl = useMemo(() => {
    if (!activeTime) return null;
    const qs = new URLSearchParams({
      product: productId,
      time: activeTime,
      model: modelId,
    });
    if (diffModelId && diffModelId !== modelId) qs.set("diff", diffModelId);
    return `/api/weather/ecmwf-map/frame?${qs}`;
  }, [productId, activeTime, modelId, diffModelId]);

  useEffect(() => {
    if (!imageUrl) return;
    setFrameLoading(true);
    const img = new Image();
    img.onload = () => setFrameLoading(false);
    img.onerror = () => setFrameLoading(false);
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    if (!times.length || !activeTime) return;
    const idxs = [timeIndex - 1, timeIndex + 1, timeIndex + 2].filter(
      (i) => i >= 0 && i < times.length && i !== timeIndex,
    );
    for (const i of idxs) {
      const t = times[i]!;
      const qs = new URLSearchParams({
        product: productId,
        time: t,
        model: modelId,
      });
      if (diffModelId && diffModelId !== modelId) qs.set("diff", diffModelId);
      const img = new Image();
      img.src = `/api/weather/ecmwf-map/frame?${qs}`;
    }
  }, [productId, timeIndex, times, activeTime, modelId, diffModelId]);

  useEffect(() => {
    if (!playing || times.length < 2) return;
    const id = window.setInterval(() => {
      setTimeIndex((i) => (i + 1) % times.length);
    }, 700);
    return () => window.clearInterval(id);
  }, [playing, times.length]);

  useEffect(() => {
    if (!probe || transectMode) {
      if (!probe) setProbeSample(null);
      return;
    }
    const ac = new AbortController();
    setProbeLoading(true);
    const qs = new URLSearchParams({
      product: productId,
      lat: String(probe.lat),
      lon: String(probe.lng),
      model: modelId,
    });
    if (activeTime) qs.set("time", activeTime);
    if (diffModelId && diffModelId !== modelId) qs.set("diff", diffModelId);
    void fetch(`/api/weather/ecmwf-map/point?${qs}`, {
      cache: "no-store",
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sample unavailable (${res.status})`);
        return (await res.json()) as ProbeSample;
      })
      .then((json) => {
        if (ac.signal.aborted) return;
        setProbeSample(json);
        setProbeLoading(false);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setProbeLoading(false);
        setProbeSample(null);
        setError(err instanceof Error ? err.message : "Sample unavailable");
      });
    return () => ac.abort();
  }, [probe, productId, activeTime, modelId, diffModelId, transectMode]);

  // Meteogram at probe or saved place
  useEffect(() => {
    const lat = probe?.lat ?? place?.lat;
    const lon = probe?.lng ?? place?.lon;
    if (lat == null || lon == null) {
      setMeteogram(null);
      return;
    }
    const ac = new AbortController();
    const qs = new URLSearchParams({
      product: productId,
      lat: String(lat),
      lon: String(lon),
      model: modelId,
      series: "1",
    });
    void fetch(`/api/weather/ecmwf-map/point?${qs}`, {
      cache: "no-store",
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("meteogram");
        return (await res.json()) as MeteogramSeries;
      })
      .then((json) => {
        if (ac.signal.aborted) return;
        setMeteogram(json);
      })
      .catch(() => {
        if (!ac.signal.aborted) setMeteogram(null);
      });
    return () => ac.abort();
  }, [probe, place, productId, modelId]);

  // Mini Skew-T when enabled + probe set (IFS preferred; fall back to pulse).
  useEffect(() => {
    if (!showSkewt || !probe || transectMode) {
      if (!showSkewt) {
        setSounding(null);
        setSoundingError(null);
      }
      return;
    }
    const ac = new AbortController();
    setSoundingLoading(true);
    setSoundingError(null);
    const preferred = mapModelToSounding(modelId);
    const modelsToTry =
      preferred === "pulse" ? (["pulse"] as const) : ([preferred, "pulse"] as const);

    void (async () => {
      let lastErr: string | null = null;
      for (const model of modelsToTry) {
        if (ac.signal.aborted) return;
        try {
          const qs = new URLSearchParams({
            mode: "model",
            model,
            lat: String(probe.lat),
            lon: String(probe.lng),
          });
          if (activeTime) qs.set("time", activeTime);
          const res = await fetch(`/api/weather/sounding?${qs}`, {
            cache: "no-store",
            signal: ac.signal,
          });
          if (!res.ok) throw new Error(`Sounding unavailable (${res.status})`);
          const json = (await res.json()) as SoundingPayload;
          if (ac.signal.aborted) return;
          if (json.status === "ok" && json.levels.length) {
            setSounding(json);
            setSoundingLoading(false);
            setSoundingError(null);
            return;
          }
          lastErr = json.message ?? "No sounding levels";
        } catch (err) {
          if (ac.signal.aborted) return;
          lastErr = err instanceof Error ? err.message : "Sounding unavailable";
        }
      }
      if (ac.signal.aborted) return;
      setSounding(null);
      setSoundingLoading(false);
      setSoundingError(lastErr);
    })();

    return () => ac.abort();
  }, [showSkewt, probe, modelId, activeTime, transectMode]);

  // Cross-section when both ends set
  useEffect(() => {
    if (!transectMode || !probe || !probeB) {
      if (!transectMode) {
        setXsec(null);
        setXsecError(null);
      }
      return;
    }
    const ac = new AbortController();
    setXsecLoading(true);
    setXsecError(null);
    const qs = new URLSearchParams({
      startLat: String(probe.lat),
      startLon: String(probe.lng),
      endLat: String(probeB.lat),
      endLon: String(probeB.lng),
      model: modelId,
      field: productId.startsWith("rh_")
        ? "rh"
        : productId.startsWith("wind_")
          ? "wind"
          : "temperature",
      columns: "10",
    });
    if (activeTime) qs.set("time", activeTime);
    void fetch(`/api/weather/cross-section?${qs}`, {
      cache: "no-store",
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Cross-section failed (${res.status})`);
        return (await res.json()) as CrossSectionPayload;
      })
      .then((json) => {
        if (ac.signal.aborted) return;
        setXsec(json);
        setXsecLoading(false);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setXsec(null);
        setXsecLoading(false);
        setXsecError(
          err instanceof Error ? err.message : "Cross-section unavailable",
        );
      });
    return () => ac.abort();
  }, [transectMode, probe, probeB, modelId, productId, activeTime]);

  const products = useMemo(() => {
    const list = catalog?.products ?? [];
    if (groupFilter === "all") return list;
    return list.filter((p) => p.group === groupFilter);
  }, [catalog, groupFilter]);

  const activeProduct = catalog?.products.find((p) => p.id === productId);
  const modelLabel =
    models.find((m) => m.id === modelId)?.label ?? catalog?.modelLabel ?? "ECMWF";
  const diffLabel = diffModelId
    ? models.find((m) => m.id === diffModelId)?.label
    : null;

  const probeLabel = probeLoading
    ? "…"
    : probeSample?.formatted ?? null;

  const momentShareText = useMemo(() => {
    const productLabel = activeProduct?.label ?? "model field";
    const when = activeTime ? formatHourLabel(activeTime) : "latest";
    const pair = diffLabel ? `${modelLabel}−${diffLabel}` : modelLabel;
    if (probeSample?.formatted) {
      return `SkyWatch ${pair} · ${probeSample.formatted} · ${productLabel} · ${when}`;
    }
    return `SkyWatch ${pair} · ${productLabel} · ${when}`;
  }, [activeProduct, activeTime, probeSample, modelLabel, diffLabel]);

  async function onShareMoment() {
    const result = await shareContent({
      title: "SkyWatch Models",
      text: momentShareText,
      url: absoluteAppUrl(
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/models",
      ),
    });
    if (result === "shared" || result === "copied") {
      setShareState(result);
      window.setTimeout(() => setShareState("idle"), 2000);
    }
  }

  function onMapClick(ll: { lat: number; lng: number }) {
    setError(null);
    if (transectMode) {
      if (!probe || (probe && probeB)) {
        setProbe(ll);
        setProbeB(null);
        setXsec(null);
        return;
      }
      setProbeB(ll);
      return;
    }
    setProbe(ll);
  }

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[1600px] space-y-3 px-3 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              Model lab
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white sm:text-3xl">
              Models
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-white/70">
              Switch ECMWF / ICON / GFS, scrub hourly fields, diff two models,
              probe a point, open a mini Skew-T, or draw a transect
              cross-section.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                href="/ensemble"
                className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/90 hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)]"
              >
                Ensemble
              </Link>
              <button
                type="button"
                onClick={() => void onShareMoment()}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)]"
              >
                <Share2 className="h-3.5 w-3.5" aria-hidden />
                {shareState === "copied"
                  ? "Link copied"
                  : shareState === "shared"
                    ? "Shared"
                    : "Share moment"}
              </button>
            </div>
            {catalog?.attribution ? (
              <p className="text-[10px] text-white/45">{catalog.attribution}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
            Model
          </span>
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setPlaying(false);
                setPreferredTime(activeTime);
                setModelId(m.id);
                if (diffModelId === m.id) setDiffModelId(null);
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold",
                modelId === m.id
                  ? "bg-[var(--cyan)]/25 text-[var(--cyan)]"
                  : "text-white/60 hover:bg-white/[0.06] hover:text-white",
              )}
            >
              {m.label}
            </button>
          ))}
          <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-white/45">
            Diff −
          </span>
          <button
            type="button"
            onClick={() => setDiffModelId(null)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-semibold",
              !diffModelId
                ? "bg-white/12 text-white"
                : "text-white/55 hover:text-white",
            )}
          >
            Off
          </button>
          {models
            .filter((m) => m.id !== modelId)
            .map((m) => (
              <button
                key={`diff-${m.id}`}
                type="button"
                onClick={() => setDiffModelId(m.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                  diffModelId === m.id
                    ? "bg-amber-400/20 text-amber-200"
                    : "text-white/55 hover:text-white",
                )}
              >
                {m.label}
              </button>
            ))}
          <button
            type="button"
            onClick={() => {
              setShowSkewt((v) => !v);
              if (transectMode) setTransectMode(false);
            }}
            className={cn(
              "ml-auto rounded-md px-2.5 py-1 text-xs font-semibold",
              showSkewt
                ? "bg-[var(--cyan)]/25 text-[var(--cyan)]"
                : "text-white/55 hover:text-white",
            )}
          >
            Skew-T
          </button>
          <button
            type="button"
            onClick={() => {
              setTransectMode((v) => {
                const next = !v;
                if (next) {
                  setShowSkewt(false);
                  setProbeB(null);
                  setXsec(null);
                }
                return next;
              });
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-semibold",
              transectMode
                ? "bg-amber-400/20 text-amber-200"
                : "text-white/55 hover:text-white",
            )}
          >
            Transect
          </button>
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
                      setPreferredTime(activeTime);
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
                onMapClick={onMapClick}
                probePoint={
                  probe
                    ? {
                        lat: probe.lat,
                        lng: probe.lng,
                        label: transectMode
                          ? "A"
                          : probeLabel,
                      }
                    : null
                }
                probePointB={
                  probeB
                    ? {
                        lat: probeB.lat,
                        lng: probeB.lng,
                        label: "B",
                      }
                    : null
                }
                showTransectLine={transectMode}
              />
              {(loadingCatalog || frameLoading) && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] bg-gradient-to-b from-[#0a1224]/80 to-transparent px-3 py-2 text-xs font-semibold text-white/80">
                  Loading {modelLabel}
                  {diffLabel ? ` − ${diffLabel}` : ""}{" "}
                  {activeProduct?.shortLabel ?? "field"}…
                </div>
              )}
              {probe && !transectMode ? (
                <div className="absolute left-3 top-3 z-[500] max-w-[260px] rounded-xl border border-white/15 bg-[#0a1224]/92 px-3 py-2 shadow-lg backdrop-blur-md">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--cyan)]">
                        {probeSample?.label ?? activeProduct?.label ?? "Point"}
                      </p>
                      <p className="mt-0.5 font-[family-name:var(--font-display)] text-xl font-extrabold text-white">
                        {probeLoading
                          ? "…"
                          : (probeSample?.formatted ?? "—")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/55">
                        {probe.lat.toFixed(2)}°, {probe.lng.toFixed(2)}°
                        {probeSample?.time
                          ? ` · ${formatHourLabel(probeSample.time)}`
                          : ""}
                      </p>
                      <button
                        type="button"
                        onClick={() => void onShareMoment()}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--cyan)] hover:underline"
                      >
                        <Link2 className="h-3 w-3" aria-hidden />
                        {shareState === "copied" ? "Copied link" : "Share point"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="rounded-md px-1.5 py-0.5 text-xs text-white/50 hover:bg-white/10 hover:text-white"
                      aria-label="Clear point"
                      onClick={() => {
                        setProbe(null);
                        setProbeSample(null);
                        setSounding(null);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg bg-[#0a1224]/70 px-2.5 py-1.5 text-[11px] font-medium text-white/65">
                  {transectMode
                    ? probe && !probeB
                      ? "Click end point B for transect"
                      : "Click start point A for transect"
                    : "Click map for value · Skew-T · share"}
                </div>
              )}
              {showSkewt && probe && !transectMode ? (
                <ModelsMiniSounding
                  sounding={sounding}
                  loading={soundingLoading}
                  error={soundingError}
                  lat={probe.lat}
                  lon={probe.lng}
                  model={mapModelToSounding(modelId)}
                  time={activeTime}
                  onClose={() => setShowSkewt(false)}
                />
              ) : null}
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
                    {diffLabel ? (
                      <span className="ml-2 text-xs font-semibold text-amber-200/90">
                        {modelLabel} − {diffLabel}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs font-normal text-white/45">
                        {modelLabel}
                      </span>
                    )}
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

            {meteogram ? (
              <ModelsMeteogram
                times={meteogram.times}
                values={meteogram.values}
                units={meteogram.units}
                label={meteogram.label}
                activeTime={activeTime}
              />
            ) : null}

            {transectMode ? (
              <ModelsCrossSectionPanel
                data={xsec}
                loading={xsecLoading}
                error={xsecError}
                onClose={() => {
                  setTransectMode(false);
                  setProbeB(null);
                  setXsec(null);
                }}
              />
            ) : null}
          </section>
        </div>
      </div>
    </SiteShell>
  );
}
