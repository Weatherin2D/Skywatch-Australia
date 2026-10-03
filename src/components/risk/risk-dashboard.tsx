"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import { RiskLegend } from "@/components/forecast/risk-legend";
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
} from "@/lib/weather/auto-risk-categories";
import { cn } from "@/lib/utils";

const RISK_MAP_SETTINGS: MapSettingsState = {
  ...DEFAULT_MAP_SETTINGS,
  outlines: true,
  stateOutlines: true,
  cityLabels: false,
  satelliteBasemap: false,
};

type RiskSource = "bom" | "auto";

type RiskCatalog = {
  status: "ok" | "empty";
  source: RiskSource;
  issuedAt: string | null;
  message?: string;
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

function BomRiskLegend({ usedIds }: { usedIds: Set<string> }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {METEYE_THUNDERSTORM_CATEGORIES.map((item) => {
        const used = usedIds.size === 0 ? true : usedIds.has(item.id);
        return (
          <li
            key={item.id}
            className={cn("flex items-center gap-3", !used && "opacity-45")}
          >
            <span
              className={cn(
                "h-5 w-8 shrink-0",
                used ? "border-2 border-white/80" : "border border-white/25",
              )}
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
            <span
              className={cn(
                "text-sm font-medium tracking-wide",
                used ? "text-white/90" : "text-white/45",
              )}
            >
              {item.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function AutoRiskBlurbList({
  usedIds,
}: {
  usedIds: Set<string>;
}) {
  const blurbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of AUTO_RISK_CATEGORIES) map.set(c.id, c.blurb);
    for (const h of AUTO_HATCH_LEGEND) map.set(h.id, h.blurb);
    return map;
  }, []);

  const items = autoRiskLegendItems();
  const active = items.filter((i) => usedIds.size === 0 || usedIds.has(i.id));
  if (!active.length) return null;

  return (
    <ul className="space-y-2 border-t border-white/10 pt-3">
      {active.slice(0, 4).map((item) => {
        const blurb = blurbs.get(item.id);
        if (!blurb) return null;
        return (
          <li key={item.id} className="text-xs leading-relaxed text-white/50">
            <span className="font-semibold text-white/70">{item.label}: </span>
            {blurb}
          </li>
        );
      })}
    </ul>
  );
}

function readSourceFromUrl(): RiskSource {
  if (typeof window === "undefined") return "bom";
  const sp = new URLSearchParams(window.location.search);
  return sp.get("source") === "auto" ? "auto" : "bom";
}

function syncSourceToUrl(source: RiskSource) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (source === "auto") url.searchParams.set("source", "auto");
  else url.searchParams.delete("source");
  window.history.replaceState({}, "", url.toString());
}

export function RiskDashboard() {
  const [source, setSource] = useState<RiskSource>("bom");
  const [data, setData] = useState<PublicForecastResponse | null>(null);
  const [catalog, setCatalog] = useState<RiskCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [regionId, setRegionId] = useState<MapRegionId>("national");
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);

  useEffect(() => {
    setSource(readSourceFromUrl());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/weather/risk?source=${source}&t=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Could not load risk outlook");
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
  }, [source]);

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

  const dayHasRisk = (day: RolledDay | null | undefined) =>
    Boolean(
      day?.legend?.some((item) =>
        source === "auto" ? item.used && item.order < 100 : item.used,
      ),
    );

  const riskImageUrl =
    selectedDay != null && dayHasRisk(active)
      ? `/api/weather/risk-image?source=${source}&day=${selectedDay}&t=${encodeURIComponent(
          data?.issuedAt ?? String(selectedDay),
        )}`
      : null;

  const region = getMapRegion(regionId);
  const daySlots = data?.days ?? [];
  const autoLegendItems: DisplayLegendItem[] =
    active?.legend?.length
      ? active.legend
      : autoRiskLegendItems();

  const setSourceAndUrl = (next: RiskSource) => {
    setSource(next);
    syncSourceToUrl(next);
    setSelectedDay(null);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
            Risk
          </h1>
          <p className="max-w-2xl text-sm text-white/70 sm:text-base">
            {source === "bom"
              ? "Official BoM MetEye thunderstorm forecast — Chance of and Likely areas for the full MetEye horizon."
              : "SkyWatch automated thunderstorm outlook from model guidance — categorical risk with L1/L2 hatch overlays."}
          </p>
        </div>

        <div
          className="inline-flex rounded-xl border border-white/15 bg-white/[0.04] p-1"
          role="group"
          aria-label="Risk outlook source"
        >
          <button
            type="button"
            onClick={() => setSourceAndUrl("bom")}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-sm font-semibold transition",
              source === "bom"
                ? "bg-[var(--cyan)]/25 text-[var(--cyan)]"
                : "text-white/65 hover:text-white",
            )}
          >
            BoM
          </button>
          <button
            type="button"
            onClick={() => setSourceAndUrl("auto")}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-sm font-semibold transition",
              source === "auto"
                ? "bg-[var(--cyan)]/25 text-[var(--cyan)]"
                : "text-white/65 hover:text-white",
            )}
          >
            Automated
          </button>
        </div>
      </div>

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
                {source === "bom"
                  ? "Loading MetEye thunderstorm forecast…"
                  : "Building automated risk outlook…"}
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                <p className="font-[family-name:var(--font-display)] text-2xl text-white">
                  Outlook unavailable
                </p>
                <p className="text-sm text-white/55">{error}</p>
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
                />
                {!loading && data?.status === "empty" ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[520] flex justify-center px-4">
                    <p className="rounded-full border border-white/15 bg-[#0b1224]/85 px-4 py-2 text-center text-xs text-white/75 backdrop-blur-md sm:text-sm">
                      {data.message ??
                        (source === "bom"
                          ? "No thunderstorm areas in the current BoM MetEye forecast."
                          : "No elevated thunderstorm risk in the automated guidance.")}
                    </p>
                  </div>
                ) : null}
                {!loading &&
                data?.status === "ok" &&
                selectedDay != null &&
                !dayHasRisk(active) ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[520] flex justify-center px-4">
                    <p className="rounded-full border border-white/15 bg-[#0b1224]/85 px-4 py-2 text-center text-xs text-white/75 backdrop-blur-md sm:text-sm">
                      No thunderstorm areas for this day.
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
                "Source: SkyWatch automated model guidance (Open-Meteo)"}
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
              {source === "bom" ? "Thunderstorms" : "Auto risk"}
            </h2>
          </div>
          {source === "bom" ? (
            <>
              <BomRiskLegend usedIds={usedCategoryIds} />
              <p className="text-xs leading-relaxed text-white/50">
                Same Chance / Likely colours as MetEye. Areas show where BoM
                forecasts at least a low chance of thunderstorms in the period.
              </p>
            </>
          ) : (
            <>
              <RiskLegend items={autoLegendItems} />
              <p className="text-xs leading-relaxed text-white/50">
                Categorical colours follow the SkyWatch ladder. L1/L2 hatches
                overlay supercell-interesting environments — guidance only, not
                an official warning.
              </p>
              <AutoRiskBlurbList usedIds={usedCategoryIds} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
