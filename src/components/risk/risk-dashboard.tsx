"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import { RiskLegend } from "@/components/forecast/risk-legend";
import {
  RiskInspectPanel,
  type RiskInspectCategory,
  type RiskInspectPoint,
} from "@/components/risk/risk-inspect-panel";
import { EngineModeToggle } from "@/components/weather/engine-mode-toggle";
import {
  parseEngineUiMode,
  type EngineUiMode,
} from "@/lib/weather/engine-mode";
import {
  riskAiThermoFromSounding,
  riskSourceToSoundingModel,
} from "@/lib/weather/risk-ai-thermo";
import type { SoundingPayload } from "@/lib/weather/sounding-types";
import {
  DEFAULT_MAP_SETTINGS,
  MAP_REGIONS,
  getMapRegion,
  type MapRegionId,
  type MapSettingsState,
} from "@/components/home/mock-data";
import type {
  DisplayLegendItem,
  PublicForecastResponse,
  RolledDay,
} from "@/lib/forecast/types";
import {
  BOM_METEYE_IMAGE_BOUNDS,
  METEYE_THUNDERSTORM_CATEGORIES,
} from "@/lib/weather/bom-meteye-constants";
import {
  AUTO_HATCH_LEGEND,
  AUTO_RISK_CATEGORIES,
  autoRiskLegendItems,
  type AutoHatchId,
} from "@/lib/weather/auto-risk-categories";
import {
  MODEL_RISK_PRODUCTS,
  PRODUCT_META,
  chanceBlurbs,
  chanceLegendItems,
  resolveModelRiskProduct,
  type ModelRiskProduct,
} from "@/lib/weather/auto-risk-products";
import { cn } from "@/lib/utils";

const RISK_MAP_SETTINGS: MapSettingsState = {
  ...DEFAULT_MAP_SETTINGS,
  outlines: true,
  stateOutlines: true,
  cityLabels: false,
  satelliteBasemap: false,
};

type RiskSource = "bom" | "pulse" | "access" | "ifs" | "ukmo";

type RiskCatalog = {
  status: "ok" | "empty";
  source: RiskSource | "auto";
  product?: ModelRiskProduct;
  products?: { id: ModelRiskProduct; label: string; shortLabel: string }[];
  issuedAt: string | null;
  message?: string;
  keyTitle?: string;
  productDescription?: string;
  outlook?: PublicForecastResponse;
  days?: Array<{
    day: number;
    label: string;
    dateLabel: string;
    available: boolean;
    imageUrl: string | null;
    issuedAt: string | null;
    legend?: DisplayLegendItem[];
  }>;
  legend?: DisplayLegendItem[] | typeof METEYE_THUNDERSTORM_CATEGORIES;
  blurbs?: { id: string; blurb: string }[];
  attribution?: string;
};

function dayChipLabel(day: RolledDay): string {
  if (day.effectiveDay === 1) return "Day 1 · Today";
  return `Day ${day.effectiveDay}`;
}

function BomRiskLegend({
  usedIds,
  onItemClick,
  activeId,
}: {
  usedIds: Set<string>;
  onItemClick?: (id: string) => void;
  activeId?: string | null;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {METEYE_THUNDERSTORM_CATEGORIES.map((item) => {
        const used = usedIds.size === 0 ? true : usedIds.has(item.id);
        const active = activeId === item.id;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onItemClick?.(item.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-1 py-0.5 text-left transition hover:bg-white/[0.04]",
                active && "bg-white/[0.08] ring-1 ring-[var(--cyan)]/40",
                !used && "opacity-35",
              )}
            >
              <span
                className={cn(
                  "h-5 w-8 shrink-0",
                  used ? "border-2 border-white/80" : "border border-white/25",
                )}
                style={{ backgroundColor: item.color }}
                aria-hidden
              />
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm font-medium tracking-wide",
                    used ? "text-white/90" : "text-white/45",
                  )}
                >
                  {item.label}
                </span>
                {!used ? (
                  <span className="block text-[10px] text-white/35">
                    Not on this day&apos;s map
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ModelProductBlurbList({
  product,
  usedIds,
}: {
  product: ModelRiskProduct;
  usedIds: Set<string>;
}) {
  const blurbs = useMemo(() => {
    const map = new Map<string, string>();
    if (product === "risk") {
      for (const c of AUTO_RISK_CATEGORIES) map.set(c.id, c.blurb);
      for (const h of AUTO_HATCH_LEGEND) map.set(h.id, h.blurb);
    } else {
      for (const b of chanceBlurbs(product)) map.set(b.id, b.blurb);
    }
    return map;
  }, [product]);

  // Always list the full ladder (through L2 Hatched for categorical risk).
  // Dim unused tiers in the colour key; blurbs stay available for every step.
  const items =
    product === "risk" ? autoRiskLegendItems() : chanceLegendItems(product);
  if (!items.length) return null;

  return (
    <ul className="space-y-2 border-t border-white/10 pt-3">
      {items.map((item) => {
        const blurb = blurbs.get(item.id);
        if (!blurb) return null;
        const used = usedIds.size === 0 || usedIds.has(item.id);
        return (
          <li
            key={item.id}
            className={cn(
              "text-xs leading-relaxed",
              used ? "text-white/50" : "text-white/30",
            )}
          >
            <span
              className={cn(
                "font-semibold",
                used ? "text-white/70" : "text-white/40",
              )}
            >
              {item.label}:{" "}
            </span>
            {blurb}
          </li>
        );
      })}
    </ul>
  );
}

function readSourceFromUrl(): RiskSource {
  if (typeof window === "undefined") return "pulse";
  const sp = new URLSearchParams(window.location.search);
  const s = (sp.get("source") || "pulse").toLowerCase();
  if (s === "bom" || s === "meteye") return "bom";
  if (s === "pulse" || s === "auto") return "pulse";
  if (s === "access") return "access";
  if (s === "ifs" || s === "ecmwf" || s === "ecmwf_ifs") return "ifs";
  if (s === "ukmo" || s === "uk") return "ukmo";
  return "pulse";
}

function readProductFromUrl(): ModelRiskProduct {
  if (typeof window === "undefined") return "risk";
  const sp = new URLSearchParams(window.location.search);
  return resolveModelRiskProduct(sp.get("product"));
}

function syncUrl(
  source: RiskSource,
  product: ModelRiskProduct,
  engine: EngineUiMode,
) {
  if (typeof window === "undefined") return;
  // Only touch the query while still on /risk — never rewrite another route.
  if (window.location.pathname !== "/risk") return;
  const url = new URL(window.location.href);
  if (source === "bom") {
    url.searchParams.delete("source");
    url.searchParams.delete("product");
    url.searchParams.delete("engine");
  } else {
    url.searchParams.set("source", source);
    if (product === "risk") url.searchParams.delete("product");
    else url.searchParams.set("product", product);
    url.searchParams.set("engine", engine);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

function readEngineFromUrl(): EngineUiMode {
  if (typeof window === "undefined") return "predict";
  const sp = new URLSearchParams(window.location.search);
  return parseEngineUiMode(sp.get("engine") || "predict");
}

function isModelSource(source: RiskSource): boolean {
  return (
    source === "pulse" ||
    source === "access" ||
    source === "ifs" ||
    source === "ukmo"
  );
}

const RISK_SOURCE_OPTIONS: { id: RiskSource; label: string }[] = [
  { id: "bom", label: "BoM" },
  { id: "pulse", label: "Pulse" },
  { id: "ifs", label: "IFS" },
  { id: "ukmo", label: "UKMO" },
  { id: "access", label: "Access" },
];

function sourceBlurb(source: RiskSource, product: ModelRiskProduct): string {
  if (source === "bom") {
    return "Official BoM MetEye thunderstorm forecast — Chance of and Likely areas for the full MetEye horizon.";
  }
  const model =
    source === "access"
      ? "Access"
      : source === "ifs"
        ? "IFS"
        : source === "ukmo"
          ? "UKMO"
          : "Pulse";
  const meta = PRODUCT_META[product];
  return `SkyWatch ${model} — ${meta.description}`;
}

function sourceLoadingLabel(
  source: RiskSource,
  product: ModelRiskProduct,
): string {
  if (source === "bom") return "Loading MetEye thunderstorm forecast…";
  const model =
    source === "access"
      ? "Access"
      : source === "ifs"
        ? "IFS"
        : source === "ukmo"
          ? "UKMO"
          : "Pulse";
  return `Building ${model} ${PRODUCT_META[product].shortLabel.toLowerCase()} outlook…`;
}

function sourceEmptyFallback(
  source: RiskSource,
  product: ModelRiskProduct,
): string {
  if (source === "bom") {
    return "No thunderstorm areas in the current BoM MetEye forecast.";
  }
  const model =
    source === "access"
      ? "Access"
      : source === "ifs"
        ? "IFS"
        : source === "ukmo"
          ? "UKMO"
          : "Pulse";
  return PRODUCT_META[product].emptyMessage(model);
}

function sourceKeyTitle(source: RiskSource, product: ModelRiskProduct): string {
  if (source === "bom") return "Thunderstorms";
  return PRODUCT_META[product].keyTitle;
}

function emptyDayMessage(product: ModelRiskProduct): string {
  switch (product) {
    case "tstorm":
      return "No thunderstorm chance areas for this day.";
    case "hail":
      return "No large-hail chance areas for this day.";
    case "wind":
      return "No damaging-wind chance areas for this day.";
    case "rain":
      return "No heavy-rainfall chance areas for this day.";
    case "tornado":
      return "No tornado chance areas for this day.";
    default:
      return "No thunderstorm areas for this day.";
  }
}

export function RiskDashboard() {
  // Default Pulse so AI V1 thermo overlay is available without an extra click.
  const [source, setSource] = useState<RiskSource>("pulse");
  const [product, setProduct] = useState<ModelRiskProduct>("risk");
  const [data, setData] = useState<PublicForecastResponse | null>(null);
  const [catalog, setCatalog] = useState<RiskCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [regionId, setRegionId] = useState<MapRegionId>("national");
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const [probePoint, setProbePoint] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectData, setInspectData] = useState<
    RiskInspectPoint | RiskInspectCategory | null
  >(null);
  const [activeLegendId, setActiveLegendId] = useState<string | null>(null);
  const [engineMode, setEngineMode] = useState<EngineUiMode>("predict");

  useEffect(() => {
    setSource(readSourceFromUrl());
    setProduct(readProductFromUrl());
    setEngineMode(readEngineFromUrl());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const productQs =
          isModelSource(source) && product !== "risk"
            ? `&product=${product}`
            : "";
        let res: Response | null = null;
        let lastErr: Error | null = null;
        // Cold model computes can 504 on Vercel — retry briefly for shared cache.
        for (let attempt = 0; attempt < 3; attempt++) {
          if (cancelled) return;
          try {
            res = await fetch(
              `/api/weather/risk?source=${source}${productQs}&t=${Date.now()}`,
              { cache: "no-store" },
            );
            if (res.ok) break;
            lastErr = new Error(
              res.status === 504 || res.status === 502
                ? "Risk outlook is still building — retrying…"
                : "Could not load risk outlook",
            );
          } catch (err) {
            lastErr = err instanceof Error ? err : new Error("Failed to load");
            res = null;
          }
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1800 * (attempt + 1)));
        }
        if (!res?.ok) {
          throw lastErr ?? new Error("Could not load risk outlook");
        }
        const json = (await res.json()) as RiskCatalog;
        if (cancelled) return;
        const outlook =
          json.outlook ??
          ({
            status: json.status,
            issuedAt: json.issuedAt,
            mapView: { center: [-25.5, 134.5], zoom: 4 },
            days: (json.days ?? []).map((d) => ({
              effectiveDay: d.day,
              storedDay: d.day,
              validDate: d.dateLabel,
              label: d.label,
              dateLabel: d.dateLabel,
              isToday: d.day === 1,
              features: [],
              legend: d.legend ?? [],
              source: "categorical" as const,
            })),
            defaultDay: 1,
            message: json.message,
          } satisfies PublicForecastResponse);

        setCatalog(json);
        setData(outlook);
        const days = outlook.days ?? [];
        setSelectedDay((prev) => {
          if (prev != null && days.some((d) => d.effectiveDay === prev)) {
            return prev;
          }
          return (
            days.find((d) => d.effectiveDay === outlook.defaultDay)
              ?.effectiveDay ??
            days[0]?.effectiveDay ??
            null
          );
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setData(null);
          setCatalog(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [source, product]);

  const active = useMemo(() => {
    if (!data?.days?.length) return null;
    return (
      data.days.find((d) => d.effectiveDay === selectedDay) ?? data.days[0]
    );
  }, [data, selectedDay]);

  const usedCategoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of active?.legend ?? []) {
      if (item.used) ids.add(item.id);
    }
    return ids;
  }, [active?.legend]);

  const dayHasRisk = (day: RolledDay | null | undefined) => {
    if (!day) return false;
    const catalogDay = catalog?.days?.find((d) => d.day === day.effectiveDay);
    if (catalogDay?.available) return true;
    return Boolean(
      day.legend?.some((item) =>
        isModelSource(source) ? item.used && item.order < 100 : item.used,
      ),
    );
  };

  // Prefer API imageUrl when present — avoids blank maps if legend used-flags
  // were over-pruned while dayPoints still have signal.
  const catalogImageUrl =
    selectedDay != null
      ? (catalog?.days?.find((d) => d.day === selectedDay)?.imageUrl ?? null)
      : null;
  const productQs =
    isModelSource(source) && product !== "risk" ? `&product=${product}` : "";
  const riskImageUrl =
    catalogImageUrl ??
    (selectedDay != null && dayHasRisk(active)
      ? `/api/weather/risk-image?source=${source}${productQs}&day=${selectedDay}&t=${encodeURIComponent(
          data?.issuedAt ?? String(selectedDay),
        )}`
      : null);

  const region = getMapRegion(regionId);
  const daySlots = data?.days ?? [];
  // Colour key always shows the full categorical ladder through L2 Hatched
  // (or the full chance bands). Day-used flags only dim unused swatches.
  const autoLegendItems: DisplayLegendItem[] = useMemo(() => {
    if (product === "risk") {
      const dayLeg = active?.legend ?? [];
      const usedRanks = new Set(
        dayLeg
          .filter((i) => i.used && i.order < 100)
          .map((i) => i.order),
      );
      const usedHatches = new Set<AutoHatchId>();
      for (const i of dayLeg) {
        if (!i.used) continue;
        if (i.id === "l1_hatched") usedHatches.add("l1");
        if (i.id === "l2_hatched") usedHatches.add("l2");
      }
      return autoRiskLegendItems(
        dayLeg.length ? { usedRanks, usedHatches } : undefined,
      );
    }
    if (active?.legend?.length) return active.legend;
    return chanceLegendItems(product);
  }, [product, active?.legend]);

  const setSourceAndUrl = (next: RiskSource) => {
    const nextProduct = next === "bom" ? "risk" : product;
    setSource(next);
    if (next === "bom") setProduct("risk");
    syncUrl(next, nextProduct, engineMode);
    setSelectedDay(null);
  };

  const setProductAndUrl = (next: ModelRiskProduct) => {
    setProduct(next);
    syncUrl(source, next, engineMode);
    setSelectedDay(null);
  };

  const setEngineAndUrl = (next: EngineUiMode) => {
    setEngineMode(next);
    syncUrl(source, product, next);
  };

  const clearInspect = useCallback(() => {
    setProbePoint(null);
    setInspectData(null);
    setInspectError(null);
    setInspectLoading(false);
    setActiveLegendId(null);
  }, []);

  // Clear inspect when source/product/day/engine changes.
  useEffect(() => {
    clearInspect();
  }, [source, product, selectedDay, engineMode, clearInspect]);

  const onMapClick = useCallback(
    (ll: { lat: number; lng: number }) => {
      if (selectedDay == null) return;
      setProbePoint(ll);
      setActiveLegendId(null);
      setInspectLoading(true);
      setInspectError(null);
      setInspectData(null);
      const productQs =
        isModelSource(source) && product !== "risk"
          ? `&product=${product}`
          : "";
      const url = `/api/weather/risk-probe?source=${source}${productQs}&day=${selectedDay}&lat=${ll.lat}&lon=${ll.lng}`;
      void (async () => {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error("Could not inspect this point");
          const json = (await res.json()) as RiskInspectPoint;
          let aiThermo = null as RiskInspectPoint["aiThermo"];
          if (isModelSource(source) && engineMode !== "legacy") {
            try {
              const model = riskSourceToSoundingModel(source);
              const qs = new URLSearchParams({
                mode: "model",
                model,
                engine: engineMode,
                lat: String(ll.lat),
                lon: String(ll.lng),
              });
              const soundRes = await fetch(`/api/weather/sounding?${qs}`, {
                cache: "no-store",
              });
              if (soundRes.ok) {
                const sounding = (await soundRes.json()) as SoundingPayload;
                aiThermo = riskAiThermoFromSounding(sounding, engineMode);
              }
            } catch {
              // Thermo overlay is optional — keep risk probe.
            }
          }
          setInspectData({ ...json, kind: "point", aiThermo });
          setActiveLegendId(json.category?.id ?? null);
        } catch (err) {
          setInspectError(
            err instanceof Error ? err.message : "Inspect failed",
          );
        } finally {
          setInspectLoading(false);
        }
      })();
    },
    [selectedDay, source, product, engineMode],
  );

  const onLegendClick = useCallback(
    (categoryId: string) => {
      setProbePoint(null);
      setActiveLegendId(categoryId);
      setInspectLoading(true);
      setInspectError(null);
      setInspectData(null);
      const productQs =
        isModelSource(source) && product !== "risk"
          ? `&product=${product}`
          : "";
      const url = `/api/weather/risk-probe?source=${source}${productQs}&category=${encodeURIComponent(categoryId)}`;
      void fetch(url, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error("Could not load category");
          const json = (await res.json()) as RiskInspectCategory;
          setInspectData({ ...json, kind: "category" });
        })
        .catch((err) => {
          setInspectError(
            err instanceof Error ? err.message : "Category lookup failed",
          );
        })
        .finally(() => setInspectLoading(false));
    },
    [source, product],
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
            Risk
          </h1>
          <p className="max-w-2xl text-sm text-white/70 sm:text-base">
            {sourceBlurb(source, product)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div
            className="inline-flex max-w-full flex-wrap rounded-xl border border-white/15 bg-white/[0.04] p-1"
            role="group"
            aria-label="Risk outlook source"
          >
            {RISK_SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSourceAndUrl(opt.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                  source === opt.id
                    ? "bg-[var(--cyan)]/25 text-[var(--cyan)]"
                    : "text-white/65 hover:text-white",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {isModelSource(source) ? (
            <EngineModeToggle
              size="sm"
              value={engineMode}
              onChange={setEngineAndUrl}
              aria-label="Thermo / AI engine for map inspect"
            />
          ) : null}
        </div>
      </div>

      {isModelSource(source) ? (
        <div
          className="animate-fade-up inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1"
          role="group"
          aria-label="Model risk product"
        >
          {MODEL_RISK_PRODUCTS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setProductAndUrl(id)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition sm:text-sm",
                product === id
                  ? "bg-white/12 text-white"
                  : "text-white/55 hover:text-white",
              )}
              title={PRODUCT_META[id].label}
            >
              {PRODUCT_META[id].shortLabel}
            </button>
          ))}
        </div>
      ) : null}

      <div className="animate-fade-up-delay grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px] xl:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {daySlots.map((rolled) => {
              const day = rolled.effectiveDay;
              const selected = selectedDay === day;
              const available = dayHasRisk(rolled);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "sw-chip inline-flex flex-col items-start gap-0.5 !py-1.5",
                    selected ? "sw-chip-active" : "sw-chip-idle",
                    !available && !loading && "opacity-55",
                  )}
                >
                  <span>{dayChipLabel(rolled)}</span>
                  {rolled.dateLabel ? (
                    <span className="text-[10px] font-normal uppercase tracking-wide opacity-70">
                      {rolled.dateLabel}
                    </span>
                  ) : null}
                </button>
              );
            })}

            <div className="relative z-[70] ml-auto">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={regionMenuOpen}
                onClick={() => setRegionMenuOpen((o) => !o)}
                className={cn(
                  "sw-chip inline-flex items-center gap-1",
                  regionId !== "national" ? "sw-chip-active" : "sw-chip-idle",
                )}
              >
                Region
                <span className="font-normal opacity-80">· {region.short}</span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 opacity-80 transition",
                    regionMenuOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {regionMenuOpen ? (
                <ul
                  role="listbox"
                  aria-label="Map region"
                  className="absolute right-0 top-full z-[80] mt-1 max-h-80 min-w-[14rem] overflow-y-auto rounded-xl border border-white/10 bg-[#0f172a]/95 py-1 text-white shadow-xl backdrop-blur-xl"
                >
                  {MAP_REGIONS.map((r) => (
                    <li key={r.id} role="option" aria-selected={regionId === r.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center px-3 py-2 text-left text-sm font-semibold transition",
                          regionId === r.id
                            ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                            : "text-white/80 hover:bg-white/5 hover:text-white",
                        )}
                        onClick={() => {
                          setRegionId(r.id);
                          setRegionMenuOpen(false);
                        }}
                      >
                        {r.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="relative h-[min(68vh,720px)] min-h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-white/60">
                {sourceLoadingLabel(source, product)}
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                <p className="font-[family-name:var(--font-display)] text-2xl text-white">
                  Outlook unavailable
                </p>
                <p className="text-sm text-white/55">{error}</p>
                <button
                  type="button"
                  className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    // Bump product state identity via selectedDay null + reload
                    // by toggling a nonce through source re-fetch.
                    setSelectedDay(null);
                    setCatalog(null);
                    setData(null);
                    const productQs =
                      isModelSource(source) && product !== "risk"
                        ? `&product=${product}`
                        : "";
                    void fetch(
                      `/api/weather/risk?source=${source}${productQs}&t=${Date.now()}`,
                      { cache: "no-store" },
                    )
                      .then(async (res) => {
                        if (!res.ok) throw new Error("Could not load risk outlook");
                        const json = (await res.json()) as RiskCatalog;
                        const outlook =
                          json.outlook ??
                          ({
                            status: json.status,
                            issuedAt: json.issuedAt,
                            mapView: { center: [-25.5, 134.5], zoom: 4 },
                            days: (json.days ?? []).map((d) => ({
                              effectiveDay: d.day,
                              storedDay: d.day,
                              validDate: d.dateLabel,
                              label: d.label,
                              dateLabel: d.dateLabel,
                              isToday: d.day === 1,
                              features: [],
                              legend: d.legend ?? [],
                              source: "categorical" as const,
                            })),
                            defaultDay: 1,
                            message: json.message,
                          } satisfies PublicForecastResponse);
                        setCatalog(json);
                        setData(outlook);
                        setSelectedDay(
                          outlook.days.find(
                            (d) => d.effectiveDay === outlook.defaultDay,
                          )?.effectiveDay ??
                            outlook.days[0]?.effectiveDay ??
                            null,
                        );
                      })
                      .catch((err) => {
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Could not load risk outlook",
                        );
                      })
                      .finally(() => setLoading(false));
                  }}
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                <HomeMapDynamic
                  mode="Map"
                  regionId={regionId}
                  mapSettings={RISK_MAP_SETTINGS}
                  showRadarOverlay={false}
                  showLightning={false}
                  showSynoptic={false}
                  riskFeatures={[]}
                  riskImageUrl={riskImageUrl}
                  riskImageBounds={BOM_METEYE_IMAGE_BOUNDS}
                  riskImageDisplay="geo"
                  riskImageOpacity={0.82}
                  onMapClick={onMapClick}
                  probePoint={
                    probePoint
                      ? {
                          lat: probePoint.lat,
                          lng: probePoint.lng,
                          label:
                            inspectData?.kind === "point"
                              ? inspectData.category.label
                              : "Inspect",
                        }
                      : null
                  }
                />
                <RiskInspectPanel
                  loading={inspectLoading}
                  error={inspectError}
                  data={inspectData}
                  onClose={clearInspect}
                />
                {!loading && !inspectData && !inspectLoading ? (
                  <div className="pointer-events-none absolute left-3 top-3 z-[520] rounded-full border border-white/15 bg-[#0b1224]/8 px-3 py-1 text-[11px] text-white/65 backdrop-blur-md">
                    Tap the map to inspect a colour
                  </div>
                ) : null}
                {!loading && data?.status === "empty" ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[520] flex justify-center px-4">
                    <p className="rounded-full border border-white/15 bg-[#0b1224]/85 px-4 py-2 text-center text-xs text-white/75 backdrop-blur-md sm:text-sm">
                      {data.message ?? sourceEmptyFallback(source, product)}
                    </p>
                  </div>
                ) : null}
                {!loading &&
                data?.status === "ok" &&
                selectedDay != null &&
                !dayHasRisk(active) ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[520] flex justify-center px-4">
                    <p className="rounded-full border border-white/15 bg-[#0b1224]/85 px-4 py-2 text-center text-xs text-white/75 backdrop-blur-md sm:text-sm">
                      {emptyDayMessage(product)}
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <p className="text-xs text-white/45">
            {source === "bom"
              ? "Source: BoM MetEye thunderstorm layer (IDZ73094)"
              : catalog?.attribution ??
                `Source: SkyWatch ${source === "access" ? "Access" : source === "ifs" ? "IFS" : source === "ukmo" ? "UKMO" : "Pulse"} · Open-Meteo`}
            {data?.issuedAt
              ? ` · issued ${new Date(data.issuedAt).toLocaleString("en-AU", {
                  timeZone: "Australia/Sydney",
                  dateStyle: "medium",
                  timeStyle: "short",
                })} (AEST/AEDT)`
              : ""}
            {source === "bom"
              ? ". Each day uses the same 3-hourly MetEye frame BoM shows for that period (out to ~7 days)."
              : ". Guidance only — not an official warning product."}
          </p>
        </section>

        <aside className="sw-panel h-fit space-y-3 p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              Key
            </p>
            <h2 className="mt-1 font-[family-name:var(--font-display)] text-lg font-bold text-white">
              {sourceKeyTitle(source, product)}
            </h2>
          </div>
          {source === "bom" ? (
            <>
              <BomRiskLegend
                usedIds={usedCategoryIds}
                onItemClick={onLegendClick}
                activeId={activeLegendId}
              />
              <p className="text-xs leading-relaxed text-white/50">
                Same Chance / Likely colours as MetEye. Dimmed = not on this
                day&apos;s map. Tap a swatch or the map for details.
              </p>
            </>
          ) : (
            <>
              <RiskLegend
                items={autoLegendItems}
                onItemClick={(item) => onLegendClick(item.id)}
                activeId={activeLegendId}
              />
              <p className="text-xs leading-relaxed text-white/50">
                {product === "risk"
                  ? "Only colours that survive onto today's painted map stay bright — higher ladder steps need organised shear/CAPE and are often capped in the tropics. Tap a swatch or the map for why."
                  : `${PRODUCT_META[product].description} Dimmed bands are not on this day's map. Tap a swatch or coloured area for local odds.`}
              </p>
              <ModelProductBlurbList
                product={product}
                usedIds={usedCategoryIds}
              />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
