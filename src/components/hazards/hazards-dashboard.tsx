"use client";

import { useCallback, useEffect, useState } from "react";
import { Flame, SunMedium, Waves } from "lucide-react";
import { LocationSearch } from "@/components/forecast/location-search";
import { SiteShell } from "@/components/site/site-shell";
import { useSavedPlace } from "@/hooks/use-saved-place";
import type { HazardsPayload } from "@/lib/weather/hazards";
import { STATE_CAPITALS, formatForecastHour } from "@/lib/weather/location-forecast";

type Place = { geohash: string; lat?: number; lon?: number; label: string };

function uvTone(index: number | null): string {
  if (index == null) return "bg-white/15";
  if (index <= 2) return "bg-emerald-500/80";
  if (index <= 5) return "bg-yellow-400/85";
  if (index <= 7) return "bg-orange-500/85";
  if (index <= 10) return "bg-red-500/85";
  return "bg-fuchsia-600/85";
}

export function HazardsDashboard() {
  const { place: saved, saveFromBomLocation } = useSavedPlace();
  const [place, setPlace] = useState<Place>({
    geohash: STATE_CAPITALS.nsw.geohash,
    lat: -33.87,
    lon: 151.21,
    label: "Sydney, NSW",
  });
  const [data, setData] = useState<HazardsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    setPlace({
      geohash: saved.geohash,
      lat: saved.lat,
      lon: saved.lon,
      label: `${saved.name}, ${saved.state}`,
    });
  }, [saved]);

  const load = useCallback(async (p: Place, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ geohash: p.geohash });
      if (p.lat != null) params.set("lat", String(p.lat));
      if (p.lon != null) params.set("lon", String(p.lon));
      const res = await fetch(`/api/weather/hazards?${params}`, {
        signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Hazards unavailable (${res.status})`);
      const json = (await res.json()) as HazardsPayload;
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

  const tz = data?.location.timezone || "Australia/Sydney";
  const maxUv = Math.max(
    1,
    ...(data?.uv.hourly.map((h) => h.uv ?? 0) ?? [1]),
  );

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[960px] space-y-5 px-3 py-5 sm:px-4 sm:py-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
            Local hazards
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white sm:text-3xl">
            UV · Fire · Marine
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-white/70">
            Sun protection, fire weather, and coastal wave guidance for your
            place. Marine wind warnings also appear under Warnings (Minor).
          </p>
        </div>

        <LocationSearch
          className="w-full"
          onSelect={(loc) => {
            void saveFromBomLocation(loc).then((p) => {
              setPlace({
                geohash: p.geohash,
                lat: p.lat,
                lon: p.lon,
                label: `${p.name}, ${p.state}`,
              });
            });
          }}
        />

        <p className="text-sm font-semibold text-white">{place.label}</p>

        {loading && !data ? (
          <p className="text-sm text-white/70">Loading hazards…</p>
        ) : null}
        {error && !data ? (
          <p className="sw-panel p-4 text-sm text-white/80">{error}</p>
        ) : null}

        {data ? (
          <>
            <section className="sw-panel p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                <SunMedium className="h-4 w-4" aria-hidden />
                UV index
              </h2>
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <p className="text-4xl font-bold text-white">
                  {data.uv.todayIndex != null ? data.uv.todayIndex : "—"}
                </p>
                <p className="pb-1 text-sm text-white/75">
                  {data.uv.todayCategory || "Today’s max UV"}
                </p>
              </div>
              {data.uv.hourly.some((h) => h.uv != null) ? (
                <div className="sw-chip-row sm:gap-1.5">
                  {data.uv.hourly.map((h) => (
                    <div
                      key={h.time}
                      className="flex w-11 shrink-0 flex-col items-center gap-1"
                    >
                      <div
                        className={`w-full rounded-sm ${uvTone(h.uv)}`}
                        style={{
                          height: `${8 + ((h.uv ?? 0) / maxUv) * 36}px`,
                        }}
                        title={h.uv != null ? `UV ${h.uv}` : "—"}
                      />
                      <span className="text-[9px] text-white/50">
                        {formatForecastHour(h.time, tz)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-white/65">
                  No hourly UV available for this location.
                </p>
              )}
            </section>

            <section className="sw-panel p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                <Flame className="h-4 w-4" aria-hidden />
                Fire weather
              </h2>
              {data.fire.rating ? (
                <p
                  className="text-2xl font-bold text-white"
                  style={
                    data.fire.colour ? { color: data.fire.colour } : undefined
                  }
                >
                  {data.fire.rating}
                </p>
              ) : data.fire.fwi != null ? (
                <p className="text-2xl font-bold text-white">
                  FWI {Math.round(data.fire.fwi * 10) / 10}
                </p>
              ) : (
                <p className="text-lg font-semibold text-white/70">Unavailable</p>
              )}
              <p className="mt-2 text-xs text-white/65">{data.fire.note}</p>
              {data.fire.guidance ? (
                <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-200/80">
                  Guidance only
                </p>
              ) : null}
            </section>

            <section className="sw-panel p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                <Waves className="h-4 w-4" aria-hidden />
                Marine
              </h2>
              {data.marine.available ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    ["Wave height", data.marine.waveHeightM, "m"],
                    ["Swell", data.marine.swellHeightM, "m"],
                    ["Swell period", data.marine.swellPeriodS, "s"],
                    ["Wind waves", data.marine.windWaveHeightM, "m"],
                    ["Wind", data.marine.windKmh, "km/h"],
                    ["Wind dir", data.marine.windDirDeg, "°"],
                  ].map(([label, value, unit]) => (
                    <div
                      key={String(label)}
                      className="rounded-md bg-black/25 px-2.5 py-2"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-white/50">
                        {label}
                      </p>
                      <p className="text-lg font-bold text-white">
                        {value != null
                          ? `${Math.round(Number(value) * 10) / 10}${unit}`
                          : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-white/65">
                  Marine fields unavailable inland or upstream failed. Coastal
                  coordinates work best. Check Warnings for marine wind alerts.
                </p>
              )}
              <p className="mt-2 text-[10px] text-white/45">
                {data.marine.attribution}
              </p>
            </section>

            <p className="text-xs text-white/45">Source: {data.attribution}</p>
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
