"use client";

import { useCallback, useEffect, useState } from "react";
import { LocationSearch } from "@/components/forecast/location-search";
import { SiteShell } from "@/components/site/site-shell";
import { useSavedPlace } from "@/hooks/use-saved-place";
import type { ClimateOutlookPayload } from "@/lib/weather/climate";
import { STATE_CAPITALS } from "@/lib/weather/location-forecast";
import { cn } from "@/lib/utils";

type Place = { lat: number; lon: number; label: string; geohash?: string };

export function ClimateDashboard() {
  const { place: saved, saveFromBomLocation } = useSavedPlace();
  const [place, setPlace] = useState<Place>({
    lat: -33.87,
    lon: 151.21,
    label: "Sydney, NSW",
    geohash: STATE_CAPITALS.nsw.geohash,
  });
  const [data, setData] = useState<ClimateOutlookPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const url = `/api/weather/climate?lat=${p.lat}&lon=${p.lon}&place=${encodeURIComponent(p.label)}&days=16`;
      const res = await fetch(url, { signal, cache: "no-store" });
      if (!res.ok) throw new Error(`Climate outlook unavailable (${res.status})`);
      const json = (await res.json()) as ClimateOutlookPayload;
      if (signal?.aborted) return;
      setData(json);
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

  const maxRain = Math.max(
    1,
    ...(data?.days.map((d) => d.rainMm ?? 0) ?? [1]),
  );

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[960px] space-y-5 px-3 py-5 sm:px-4 sm:py-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
            Extended outlook
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white sm:text-3xl">
            Climate guidance
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-white/70">
            Temperature and rainfall guidance for 14 to 16 days ahead. Use it
            for broad planning only; it is not an official Bureau of Meteorology
            seasonal outlook.
          </p>
        </div>

        <LocationSearch
          className="w-full"
          onSelect={(loc) => {
            void saveFromBomLocation(loc).then((p) => {
              setPlace({
                lat: p.lat,
                lon: p.lon,
                label: `${p.name}, ${p.state}`,
                geohash: p.geohash,
              });
            });
          }}
        />

        <p className="text-sm font-semibold text-white">
          {place.label}
        </p>

        {loading && !data ? (
          <p className="text-sm text-white/70">Loading extended outlook…</p>
        ) : null}
        {error && !data ? (
          <p className="sw-panel p-4 text-sm text-white/80">{error}</p>
        ) : null}

        {data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Avg max", data.summary.avgMaxC != null ? `${data.summary.avgMaxC}°` : "—"],
                ["Avg min", data.summary.avgMinC != null ? `${data.summary.avgMinC}°` : "—"],
                ["Total rain", data.summary.totalRainMm != null ? `${data.summary.totalRainMm} mm` : "—"],
                ["Wet days (≥1 mm)", String(data.summary.wetDays)],
              ].map(([k, v]) => (
                <div key={k} className="sw-panel p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/50">
                    {k}
                  </p>
                  <p className="mt-1 text-xl font-bold text-white">{v}</p>
                </div>
              ))}
            </div>

            <section className="sw-panel p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                Daily guidance
              </h2>
              <ul className="space-y-2">
                {data.days.map((d) => {
                  const [y, m, day] = d.date.split("-").map(Number);
                  const label = new Intl.DateTimeFormat("en-AU", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  }).format(new Date(Date.UTC(y!, m! - 1, day!, 12)));
                  const rainW =
                    d.rainMm == null
                      ? 0
                      : Math.max(4, (d.rainMm / maxRain) * 100);
                  return (
                    <li
                      key={d.date}
                      className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[7rem_1fr_auto]"
                    >
                      <span className="font-semibold text-white/80">{label}</span>
                      <div className="min-w-0">
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-sky-400/80"
                            style={{ width: `${rainW}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[10px] text-white/45">
                          Rain {d.rainMm != null ? `${d.rainMm} mm` : "—"}
                          {d.rainChancePct != null
                            ? ` · ${Math.round(d.rainChancePct)}%`
                            : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-right text-xs font-bold text-white">
                        <span className="text-white/50">
                          {d.tempMinC != null ? `${Math.round(d.tempMinC)}°` : "—"}
                        </span>
                        {" / "}
                        <span className="text-[var(--cyan)]">
                          {d.tempMaxC != null ? `${Math.round(d.tempMaxC)}°` : "—"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-amber-100/80">{data.disclaimer}</p>
              <p className="mt-1 text-[10px] text-white/45">{data.attribution}</p>
            </section>

            <section className="sw-panel p-4">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                Official BoM seasonal products
              </h2>
              <ul className="space-y-2">
                {data.bomLinks.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "text-sm font-semibold text-[var(--cyan)] hover:underline",
                      )}
                    >
                      {link.label} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
