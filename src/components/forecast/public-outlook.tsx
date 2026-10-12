"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicForecastResponse, RolledDay } from "@/lib/forecast/types";
import { OutlookMapDynamic } from "@/components/forecast/outlook-map-dynamic";
import { RiskLegend } from "@/components/forecast/risk-legend";
import { cn } from "@/lib/utils";

export function PublicOutlook() {
  const [data, setData] = useState<PublicForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/forecast?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Could not load forecast");
        const json = (await res.json()) as PublicForecastResponse;
        if (cancelled) return;
        setData(json);
        setSelectedDay((prev) => {
          if (
            prev != null &&
            json.days.some((d) => d.effectiveDay === prev)
          ) {
            return prev;
          }
          return json.defaultDay;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const active: RolledDay | null = useMemo(() => {
    if (!data?.days?.length) return null;
    return (
      data.days.find((d) => d.effectiveDay === selectedDay) ?? data.days[0]
    );
  }, [data, selectedDay]);

  return (
    <div className="relative min-h-[70vh] overflow-hidden px-3 py-5 sm:px-4 sm:py-6 lg:px-5">
      <header className="relative z-10 mx-auto mb-5 flex w-full max-w-7xl items-end justify-between gap-6">
        <div className="animate-fade-up">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
            Severe weather
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Risk outlook
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/65 sm:text-base">
            Public severe convective outlooks for Australia. Zoom and pan the
            map to explore risk areas.
          </p>
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-7xl">
        {loading && (
          <div className="flex h-[50vh] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/60 sm:h-[62vh]">
            Loading outlook…
          </div>
        )}

        {!loading && error && (
          <div className="flex h-[40vh] flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] text-center">
            <p className="font-[family-name:var(--font-display)] text-2xl text-white">
              Outlook unavailable
            </p>
            <p className="text-sm text-white/55">{error}</p>
          </div>
        )}

        {!loading && !error && data?.status === "empty" && (
          <div className="flex h-[42vh] flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-center sm:h-[50vh]">
            <p className="font-[family-name:var(--font-display)] text-2xl text-white sm:text-3xl">
              No active outlook
            </p>
            <p className="max-w-md text-sm text-white/55">
              {data.message ??
                "A forecast has not been issued, or previous day risks have rolled off."}
            </p>
          </div>
        )}

        {!loading && !error && data && data.status === "ok" && active && (
          <div className="animate-fade-up-delay grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
            <section className="min-w-0">
              <div className="mb-4 flex flex-wrap gap-2">
                {data.days.map((day) => {
                  const selected = day.effectiveDay === active.effectiveDay;
                  return (
                    <button
                      key={day.effectiveDay}
                      type="button"
                      onClick={() => setSelectedDay(day.effectiveDay)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition",
                        selected
                          ? "border-[var(--cyan)]/50 bg-[var(--cyan)] text-[#041018] shadow-[0_0_20px_rgba(34,211,238,0.25)]"
                          : "border-white/10 bg-white/[0.04] text-white/65 hover:border-white/25 hover:text-white",
                      )}
                    >
                      <span className="block text-sm font-semibold tracking-wide">
                        {day.label}
                      </span>
                      <span className="block text-xs opacity-70">
                        {day.dateLabel}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="h-[50vh] min-h-[300px] overflow-hidden rounded-2xl border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.35)] sm:h-[64vh] sm:min-h-[360px]">
                <OutlookMapDynamic
                  mapView={data.mapView}
                  features={active.features}
                  legend={active.legend}
                />
              </div>

              <p className="mt-3 text-xs text-white/45">
                {active.features.length
                  ? `${active.features.length} risk area${active.features.length === 1 ? "" : "s"} · ${active.source === "customLayers" ? "Thunderstate estimate" : "risk categories"}`
                  : "No polygons drawn for this day."}
                {data.issuedAt
                  ? ` · Issued ${new Date(data.issuedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEST/AEDT`
                  : null}
              </p>
            </section>

            <aside className="sw-panel p-4 lg:self-start">
              <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-white">
                Key
              </h2>
              <RiskLegend items={active.legend} />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
