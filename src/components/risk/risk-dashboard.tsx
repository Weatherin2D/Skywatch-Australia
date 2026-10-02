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
import {
  BOM_THUNDERSTORM_CATEGORIES,
  type BomRiskDayPublic,
  type BomThunderstormDay,
} from "@/lib/weather/bom-thunderstorm";
import { cn } from "@/lib/utils";

type RiskApiResponse = {
  status: "ok" | "empty";
  updatedAt?: string;
  days: BomRiskDayPublic[];
  legend?: typeof BOM_THUNDERSTORM_CATEGORIES;
  source?: string;
  error?: string;
};

const RISK_MAP_SETTINGS: MapSettingsState = {
  ...DEFAULT_MAP_SETTINGS,
  outlines: true,
  stateOutlines: true,
  cityLabels: false,
  satelliteBasemap: false,
};

function BomRiskLegend({
  items = BOM_THUNDERSTORM_CATEGORIES,
}: {
  items?: typeof BOM_THUNDERSTORM_CATEGORIES;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3">
          <span
            className="h-5 w-8 shrink-0 border-2 border-white/80"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          <span className="text-sm font-medium tracking-wide text-white/90">
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RiskDashboard() {
  const [data, setData] = useState<RiskApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState<BomThunderstormDay>(1);
  const [regionId, setRegionId] = useState<MapRegionId>("national");
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/weather/risk?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Could not load thunderstorm outlook");
        const json = (await res.json()) as RiskApiResponse;
        if (cancelled) return;
        setData(json);
        const first =
          json.days.find((d) => d.available)?.day ??
          (json.days[0]?.day as BomThunderstormDay | undefined) ??
          1;
        setDay(first);
        const active = json.days.find((d) => d.day === first);
        if (active?.regionId) setRegionId(active.regionId);
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

  const active = useMemo(
    () => data?.days.find((d) => d.day === day) ?? null,
    [data, day],
  );

  useEffect(() => {
    if (!active?.available) return;
    // Follow the chart's native region when switching days.
    setRegionId(active.regionId);
  }, [active?.day, active?.available, active?.regionId]);

  const region = getMapRegion(regionId);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
            Risk
          </h1>
          <p className="max-w-2xl text-sm text-white/70 sm:text-base">
            Bureau of Meteorology thunderstorm forecast charts for Day 1–3 —
            possible and likely thunderstorm / severe thunderstorm areas.
          </p>
        </div>
        <a
          href="/risk/admin"
          className="hidden text-xs uppercase tracking-[0.22em] text-white/40 transition hover:text-[var(--cyan)] sm:inline"
        >
          Admin
        </a>
      </div>

      <div className="animate-fade-up-delay grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px] xl:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              data?.days ??
              ([1, 2, 3] as BomThunderstormDay[]).map((d) => ({
                day: d,
                label: `Day ${d}`,
                dateLabel: "",
                available: false,
              }))
            ).map((slot) => {
              const selected = day === slot.day;
              return (
                <button
                  key={slot.day}
                  type="button"
                  onClick={() => setDay(slot.day)}
                  className={cn(
                    "sw-chip inline-flex flex-col items-start gap-0.5 !py-1.5",
                    selected ? "sw-chip-active" : "sw-chip-idle",
                    !slot.available && !loading && "opacity-55",
                  )}
                >
                  <span>{slot.label}</span>
                  {slot.dateLabel ? (
                    <span className="text-[10px] font-normal uppercase tracking-wide opacity-70">
                      {slot.dateLabel}
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
                Loading thunderstorm outlook…
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
                  riskImageUrl={active?.available ? active.imageUrl : null}
                  riskImageBounds={active?.imageBounds ?? null}
                  riskImageDisplay={active?.display ?? "sheet"}
                />
                {!active?.available ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[520] flex justify-center px-4">
                    <p className="rounded-full border border-white/15 bg-[#0b1224]/85 px-4 py-2 text-center text-xs text-white/75 backdrop-blur-md sm:text-sm">
                      No BoM thunderstorm chart for this day yet.
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {active?.issuedAt ? (
            <p className="text-xs text-white/45">
              Chart updated{" "}
              {new Date(active.issuedAt).toLocaleString("en-AU", {
                timeZone: "Australia/Sydney",
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              (AEST/AEDT). Source: {data?.source ?? "Bureau of Meteorology"}.
            </p>
          ) : (
            <p className="text-xs text-white/45">
              Official BoM thunderstorm forecast graphics. Upload Day 1–3 charts
              in Admin when new products are issued.
            </p>
          )}
        </section>

        <aside className="sw-panel h-fit space-y-3 p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              Key
            </p>
            <h2 className="mt-1 font-[family-name:var(--font-display)] text-lg font-bold text-white">
              Convective risk
            </h2>
          </div>
          <BomRiskLegend items={data?.legend ?? BOM_THUNDERSTORM_CATEGORIES} />
          <p className="text-xs leading-relaxed text-white/50">
            Categories match BoM thunderstorm forecast charts: thunderstorms /
            severe thunderstorms as possible or likely.
          </p>
        </aside>
      </div>
    </div>
  );
}
