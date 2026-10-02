"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import {
  DEFAULT_MAP_SETTINGS,
  MAP_REGIONS,
  getMapRegion,
  type MapRegionId,
  type MapSettingsState,
} from "@/components/home/mock-data";
import type { PublicForecastResponse, RolledDay } from "@/lib/forecast/types";
import {
  BOM_METEYE_IMAGE_BOUNDS,
  METEYE_THUNDERSTORM_CATEGORIES,
} from "@/lib/weather/bom-meteye-constants";
import {
  BOM_THUNDERSTORM_CATEGORIES,
  bomLegendItems,
} from "@/lib/weather/bom-thunderstorm";
import { cn } from "@/lib/utils";

const STATE_CHART_REGIONS = new Set<MapRegionId>([
  "nsw",
  "vic",
  "qld",
  "wa",
  "sa",
  "tas",
  "nt",
]);

const RISK_MAP_SETTINGS: MapSettingsState = {
  ...DEFAULT_MAP_SETTINGS,
  outlines: true,
  stateOutlines: true,
  cityLabels: false,
  satelliteBasemap: false,
};

function dayChipLabel(day: RolledDay): string {
  if (day.effectiveDay === 1) return "Day 1 · Today";
  return `Day ${day.effectiveDay}`;
}

function BomRiskLegend({
  usedIds,
  mode,
}: {
  usedIds: Set<string>;
  mode: "meteye" | "sheet";
}) {
  const items =
    mode === "sheet"
      ? bomLegendItems().map((item) => ({
          id: item.id,
          label: item.label,
          color: item.style.fillColor,
        }))
      : METEYE_THUNDERSTORM_CATEGORIES.map((item) => ({
          id: item.id,
          label: item.label,
          color: item.color,
        }));

  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => {
        const used =
          mode === "sheet" || usedIds.size === 0 ? true : usedIds.has(item.id);
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

export function RiskDashboard() {
  const [data, setData] = useState<PublicForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [regionId, setRegionId] = useState<MapRegionId>("national");
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const [riskDisplay, setRiskDisplay] = useState<"geo" | "sheet">("geo");
  const [sheetAvailable, setSheetAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/forecast?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Could not load risk outlook");
        const json = (await res.json()) as PublicForecastResponse;
        if (cancelled) return;
        // Public risk surface is Day 1–3 only.
        const days = (json.days ?? []).filter(
          (d) => d.effectiveDay >= 1 && d.effectiveDay <= 3,
        );
        setData({ ...json, days });
        setSelectedDay((prev) => {
          if (prev != null && days.some((d) => d.effectiveDay === prev)) {
            return prev;
          }
          return (
            days.find((d) => d.effectiveDay === json.defaultDay)?.effectiveDay ??
            days[0]?.effectiveDay ??
            null
          );
        });
        // Open on an official BoM Thunderstorm Forecast chart when published.
        if (
          json.defaultRegion &&
          MAP_REGIONS.some((r) => r.id === json.defaultRegion)
        ) {
          setRegionId(json.defaultRegion as MapRegionId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
    Boolean(day?.legend?.some((item) => item.used));

  const preferStateSheet =
    STATE_CHART_REGIONS.has(regionId) &&
    selectedDay != null &&
    selectedDay <= 2;

  const riskImageUrl =
    selectedDay != null && (dayHasRisk(active) || preferStateSheet)
      ? `/api/weather/risk-image?day=${selectedDay}&region=${encodeURIComponent(
          regionId,
        )}&t=${encodeURIComponent(data?.issuedAt ?? String(selectedDay))}`
      : null;

  useEffect(() => {
    let cancelled = false;
    if (!riskImageUrl) {
      setRiskDisplay("geo");
      setSheetAvailable(false);
      return;
    }
    async function probe() {
      try {
        const res = await fetch(riskImageUrl!, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "image/png" },
        });
        if (cancelled) return;
        const mode =
          res.headers.get("X-Risk-Display") === "sheet" ? "sheet" : "geo";
        const len = Number(res.headers.get("Content-Length") || "0");
        // Tiny transparent placeholder ≈ empty.
        const empty = !res.ok || (len > 0 && len < 200);
        setRiskDisplay(mode);
        setSheetAvailable(mode === "sheet" && !empty);
      } catch {
        if (!cancelled) {
          setRiskDisplay("geo");
          setSheetAvailable(false);
        }
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, [riskImageUrl]);

  const region = getMapRegion(regionId);
  const legendMode = sheetAvailable ? "sheet" : "meteye";
  const daySlots = [1, 2, 3].map((n) => {
    const hit = data?.days.find((d) => d.effectiveDay === n) ?? null;
    return { day: n, rolled: hit };
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
            Risk
          </h1>
          <p className="max-w-2xl text-sm text-white/70 sm:text-base">
            Official BoM Thunderstorm Forecast charts for Day 1–2 when published,
            otherwise the MetEye thunderstorm layer for the matching period.
          </p>
        </div>
      </div>

      <div className="animate-fade-up-delay grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px] xl:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {daySlots.map(({ day, rolled }) => {
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
                  <span>
                    {rolled ? dayChipLabel(rolled) : day === 1 ? "Day 1 · Today" : `Day ${day}`}
                  </span>
                  {rolled?.dateLabel ? (
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
                Loading risk outlook…
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
                  riskImageUrl={
                    sheetAvailable || dayHasRisk(active) ? riskImageUrl : null
                  }
                  riskImageBounds={BOM_METEYE_IMAGE_BOUNDS}
                  riskImageDisplay={riskDisplay}
                  riskImageOpacity={riskDisplay === "sheet" ? 0.97 : 0.82}
                />
                {!loading && data?.status === "empty" ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[520] flex justify-center px-4">
                    <p className="rounded-full border border-white/15 bg-[#0b1224]/85 px-4 py-2 text-center text-xs text-white/75 backdrop-blur-md sm:text-sm">
                      {data.message ??
                        "No thunderstorm areas in the current BoM MetEye Day 1–3 forecast."}
                    </p>
                  </div>
                ) : null}
                {!loading &&
                data?.status === "ok" &&
                selectedDay != null &&
                !dayHasRisk(active) ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[520] flex justify-center px-4">
                    <p className="rounded-full border border-white/15 bg-[#0b1224]/85 px-4 py-2 text-center text-xs text-white/75 backdrop-blur-md sm:text-sm">
                      No risk areas for this day.
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <p className="text-xs text-white/45">
            {sheetAvailable
              ? `Source: BoM Thunderstorm Forecast chart for ${region.short}`
              : "Source: BoM MetEye thunderstorm layer (IDZ73094)"}
            {data?.issuedAt
              ? ` · issued ${new Date(data.issuedAt).toLocaleString("en-AU", {
                  timeZone: "Australia/Sydney",
                  dateStyle: "medium",
                  timeStyle: "short",
                })} (AEST/AEDT)`
              : ""}
            {sheetAvailable
              ? "."
              : ". National / Day 3 uses the same MetEye 3-hourly frame BoM shows for that period."}
          </p>
        </section>

        <aside className="sw-panel h-fit space-y-3 p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              Key
            </p>
            <h2 className="mt-1 font-[family-name:var(--font-display)] text-lg font-bold text-white">
              {legendMode === "sheet" ? "Convective risk" : "Thunderstorms"}
            </h2>
          </div>
          <BomRiskLegend usedIds={usedCategoryIds} mode={legendMode} />
          <p className="text-xs leading-relaxed text-white/50">
            {legendMode === "sheet"
              ? BOM_THUNDERSTORM_CATEGORIES.map((c) => c.label).join(" · ") +
                "."
              : "Same Chance / Likely colours as MetEye. Areas show where BoM forecasts at least a low chance of thunderstorms in the period."}
          </p>
        </aside>
      </div>
    </div>
  );
}
