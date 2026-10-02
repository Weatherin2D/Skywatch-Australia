"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocationSearch } from "@/components/forecast/location-search";
import { SiteShell } from "@/components/site/site-shell";
import { useSavedPlace } from "@/hooks/use-saved-place";
import type { BomLocation } from "@/lib/weather/location-forecast";
import { STATE_CAPITALS } from "@/lib/weather/location-forecast";
import type { ModelComparisonPayload, ModelId } from "@/lib/weather/models";
import { cn } from "@/lib/utils";

const CAPITAL_COORDS: Record<
  string,
  { lat: number; lon: number; name: string; state: string; geohash: string }
> = {
  nsw: { lat: -33.87, lon: 151.21, name: "Sydney", state: "NSW", geohash: STATE_CAPITALS.nsw.geohash },
  vic: { lat: -37.81, lon: 144.96, name: "Melbourne", state: "VIC", geohash: STATE_CAPITALS.vic.geohash },
  qld: { lat: -27.47, lon: 153.03, name: "Brisbane", state: "QLD", geohash: STATE_CAPITALS.qld.geohash },
  wa: { lat: -31.95, lon: 115.86, name: "Perth", state: "WA", geohash: STATE_CAPITALS.wa.geohash },
  sa: { lat: -34.93, lon: 138.6, name: "Adelaide", state: "SA", geohash: STATE_CAPITALS.sa.geohash },
  tas: { lat: -42.88, lon: 147.33, name: "Hobart", state: "TAS", geohash: STATE_CAPITALS.tas.geohash },
  act: { lat: -35.28, lon: 149.13, name: "Canberra", state: "ACT", geohash: STATE_CAPITALS.act.geohash },
  nt: { lat: -12.46, lon: 130.84, name: "Darwin", state: "NT", geohash: STATE_CAPITALS.nt.geohash },
};

const MODEL_ORDER: ModelId[] = ["ecmwf", "icon", "gfs"];
const MODEL_COLORS: Record<ModelId, string> = {
  ecmwf: "#22d3ee",
  icon: "#a78bfa",
  gfs: "#fbbf24",
};

type Place = { lat: number; lon: number; label: string; geohash?: string };

function formatDayChip(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const noon = new Date(Date.UTC(y!, m! - 1, d!, 12));
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(noon);
}

function MetricBar({
  label,
  values,
  unit,
}: {
  label: string;
  values: { id: ModelId; value: number | null }[];
  unit: string;
}) {
  const nums = values.map((v) => v.value).filter((v): v is number => v != null);
  const max = Math.max(...nums, 1);
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
        {label}
      </p>
      <ul className="space-y-1.5">
        {values.map(({ id, value }) => (
          <li key={id} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 font-semibold text-white/80">
              {id.toUpperCase()}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${value == null ? 0 : Math.max(6, (value / max) * 100)}%`,
                  backgroundColor: MODEL_COLORS[id],
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-semibold text-white">
              {value == null ? "—" : `${Math.round(value * 10) / 10}${unit}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModelsDashboard() {
  const { place: saved, saveFromBomLocation } = useSavedPlace();
  const [place, setPlace] = useState<Place>({
    lat: CAPITAL_COORDS.nsw!.lat,
    lon: CAPITAL_COORDS.nsw!.lon,
    label: "Sydney, NSW",
    geohash: CAPITAL_COORDS.nsw!.geohash,
  });
  const [data, setData] = useState<ModelComparisonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);

  useEffect(() => {
    if (!saved) return;
    setPlace({
      lat: saved.lat,
      lon: saved.lon,
      label: `${saved.name}, ${saved.state}`,
      geohash: saved.geohash,
    });
  }, [saved]);

  const load = useCallback(async (p: Place, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/weather/models?lat=${p.lat}&lon=${p.lon}&place=${encodeURIComponent(p.label)}&days=7`;
      const res = await fetch(url, { cache: "no-store", signal });
      if (!res.ok) throw new Error(`Model comparison unavailable (${res.status})`);
      const json = (await res.json()) as ModelComparisonPayload;
      if (signal?.aborted) return;
      setData(json);
      setSelectedDay(0);
      setLoading(false);
    } catch (err) {
      if (signal?.aborted) return;
      setData(null);
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unavailable");
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(place, ac.signal);
    return () => ac.abort();
  }, [place, load]);

  async function selectBomLocation(loc: BomLocation) {
    try {
      const savedPlace = await saveFromBomLocation(loc);
      setPlace({
        lat: savedPlace.lat,
        lon: savedPlace.lon,
        label: `${savedPlace.name}, ${savedPlace.state}`,
        geohash: savedPlace.geohash,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Location unavailable");
    }
  }

  const active = data?.days?.[selectedDay] ?? null;
  const metrics = active?.models;

  const rainValues = useMemo(
    () =>
      MODEL_ORDER.map((id) => ({
        id,
        value: metrics?.[id]?.metrics.rainMm ?? null,
      })),
    [metrics],
  );
  const maxTempValues = useMemo(
    () =>
      MODEL_ORDER.map((id) => ({
        id,
        value: metrics?.[id]?.metrics.maxTempC ?? null,
      })),
    [metrics],
  );
  const windValues = useMemo(
    () =>
      MODEL_ORDER.map((id) => ({
        id,
        value: metrics?.[id]?.metrics.windMaxKmh ?? null,
      })),
    [metrics],
  );
  const chanceValues = useMemo(
    () =>
      MODEL_ORDER.map((id) => ({
        id,
        value: metrics?.[id]?.metrics.rainChancePct ?? null,
      })),
    [metrics],
  );

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[1100px] space-y-5 px-3 py-5 sm:px-4 sm:py-6">
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              Guidance
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white sm:text-3xl">
              Model comparison
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-white/70">
              ECMWF, ICON and GFS day-by-day guidance for Australia — rain, temperature
              and wind side by side.
            </p>
          </div>
          <LocationSearch
            className="w-full"
            onSelect={(loc) => void selectBomLocation(loc)}
          />
          <div className="sw-chip-row">
            {Object.entries(CAPITAL_COORDS).map(([key, cap]) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setPlace({
                    lat: cap.lat,
                    lon: cap.lon,
                    label: `${cap.name}, ${cap.state}`,
                    geohash: cap.geohash,
                  })
                }
                className={cn(
                  "sw-chip",
                  place.geohash === cap.geohash ? "sw-chip-active" : "sw-chip-idle",
                )}
              >
                {cap.name}
              </button>
            ))}
          </div>
        </div>

        <div className="sw-panel space-y-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--cyan)]">
                Location
              </p>
              <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-white">
                {place.label}
              </h2>
            </div>
            {data?.attribution ? (
              <p className="text-[10px] text-white/45">{data.attribution}</p>
            ) : null}
          </div>

          {loading && !data ? (
            <p className="text-sm text-white/60">Loading model guidance…</p>
          ) : null}
          {error && !data ? (
            <p className="text-sm text-white/80">{error}</p>
          ) : null}

          {data?.days?.length ? (
            <div className="flex flex-wrap gap-2">
              {data.days.map((d, i) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setSelectedDay(i)}
                  className={cn(
                    "sw-chip inline-flex flex-col items-start !py-1.5",
                    selectedDay === i ? "sw-chip-active" : "sw-chip-idle",
                  )}
                >
                  <span>{i === 0 ? "Today" : `Day ${i + 1}`}</span>
                  <span className="text-[10px] font-normal opacity-70">
                    {formatDayChip(d.date)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {active ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <table className="w-full min-w-[280px] text-left text-sm">
                  <thead className="text-white/55">
                    <tr>
                      <th className="pb-2 font-semibold">Metric</th>
                      <th className="pb-2 font-semibold text-[var(--cyan)]">ECMWF</th>
                      <th className="pb-2 font-semibold" style={{ color: MODEL_COLORS.icon }}>
                        ICON
                      </th>
                      <th className="pb-2 font-semibold" style={{ color: MODEL_COLORS.gfs }}>
                        GFS
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.rows.map((row) => (
                      <tr key={row.metric} className="border-t border-white/10">
                        <td className="py-2 text-white/65">{row.metric}</td>
                        <td className="py-2 font-semibold text-white">{row.ecmwf}</td>
                        <td className="py-2 font-semibold text-white">{row.icon}</td>
                        <td className="py-2 font-semibold text-white">{row.gfs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <MetricBar label="Rain (mm)" values={rainValues} unit=" mm" />
                <MetricBar label="Max temp (°C)" values={maxTempValues} unit="°" />
                <MetricBar label="Rain chance (%)" values={chanceValues} unit="%" />
                <MetricBar label="Wind max (km/h)" values={windValues} unit="" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </SiteShell>
  );
}
