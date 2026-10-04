"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SiteShell } from "@/components/site/site-shell";
import { useSavedPlace } from "@/hooks/use-saved-place";
import type {
  EnsembleSpaghettiPayload,
  EnsembleVariable,
} from "@/lib/weather/ensemble-spaghetti";
import { cn } from "@/lib/utils";

const DEFAULT_LAT = -33.87;
const DEFAULT_LON = 151.21;

function formatTick(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    hour12: false,
  }).format(ms);
}

function SpaghettiChart({ data }: { data: EnsembleSpaghettiPayload }) {
  const w = 720;
  const h = 280;
  const pad = { l: 44, r: 16, t: 16, b: 36 };
  const all = [
    ...data.members.flatMap((m) => m.values),
    ...data.mean,
  ].filter((v): v is number => v != null);
  if (!all.length || !data.times.length) {
    return (
      <p className="text-sm text-white/55">No ensemble members returned.</p>
    );
  }
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const xOf = (i: number) =>
    pad.l + (i / Math.max(1, data.times.length - 1)) * (w - pad.l - pad.r);
  const yOf = (v: number) =>
    pad.t + (1 - (v - min) / span) * (h - pad.t - pad.b);

  const paths = data.members.map((m) => {
    const pts = m.values
      .map((v, i) => (v == null ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
    return { id: m.id, pts };
  });
  const meanPts = data.mean
    .map((v, i) => (v == null ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");

  const ticks = [0, Math.floor(data.times.length / 2), data.times.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i && v >= 0);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-auto w-full"
      role="img"
      aria-label="Ensemble spaghetti chart"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = pad.t + (1 - t) * (h - pad.t - pad.b);
        const val = min + span * t;
        return (
          <g key={t}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.08)"
            />
            <text
              x={pad.l - 6}
              y={y + 3}
              textAnchor="end"
              fill="rgba(255,255,255,0.45)"
              fontSize={10}
            >
              {val.toFixed(1)}
            </text>
          </g>
        );
      })}
      {paths.map((p) => (
        <polyline
          key={p.id}
          fill="none"
          stroke="rgba(34,211,238,0.22)"
          strokeWidth={1}
          points={p.pts}
        />
      ))}
      <polyline
        fill="none"
        stroke="rgba(251,191,36,0.95)"
        strokeWidth={2.2}
        points={meanPts}
      />
      {ticks.map((i) => (
        <text
          key={i}
          x={xOf(i)}
          y={h - 10}
          textAnchor="middle"
          fill="rgba(255,255,255,0.45)"
          fontSize={10}
        >
          {formatTick(data.times[i]!)}
        </text>
      ))}
    </svg>
  );
}

export function EnsembleDashboard() {
  const { place, ready } = useSavedPlace();
  const [variable, setVariable] = useState<EnsembleVariable>("temperature_2m");
  const [data, setData] = useState<EnsembleSpaghettiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const coords = useMemo(() => {
    if (place?.lat != null && place?.lon != null) {
      return {
        lat: place.lat,
        lon: place.lon,
        label: `${place.name}, ${place.state}`,
      };
    }
    return { lat: DEFAULT_LAT, lon: DEFAULT_LON, label: "Sydney, NSW" };
  }, [place]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      lat: String(coords.lat),
      lon: String(coords.lon),
      place: coords.label,
      var: variable,
      days: "7",
    });
    void fetch(`/api/weather/ensemble?${qs}`, {
      cache: "no-store",
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error || `Ensemble unavailable (${res.status})`);
        }
        return (await res.json()) as EnsembleSpaghettiPayload;
      })
      .then((json) => {
        if (ac.signal.aborted) return;
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setData(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Unavailable");
      });
    return () => ac.abort();
  }, [ready, coords, variable]);

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-5xl space-y-4 px-3 pb-8 pt-4 sm:px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              Ensemble
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white sm:text-3xl">
              Spaghetti
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-white/70">
              ECMWF IFS ensemble member traces for your saved place — mean in
              amber, members in cyan. Guidance only.
            </p>
          </div>
          <Link
            href="/models"
            className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/90 hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)]"
          >
            Models map
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-white/70">
            Place:{" "}
            <span className="font-semibold text-white">{coords.label}</span>
          </p>
          <div className="ml-auto flex gap-1">
            {(
              [
                ["temperature_2m", "2 m temp"],
                ["precipitation", "Precip"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setVariable(id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                  variable === id
                    ? "bg-[var(--cyan)]/25 text-[var(--cyan)]"
                    : "text-white/55 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="sw-panel p-3 sm:p-4">
          {loading ? (
            <p className="py-16 text-center text-sm text-white/55">
              Loading ensemble members…
            </p>
          ) : error ? (
            <p className="py-16 text-center text-sm text-red-300/90">{error}</p>
          ) : data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-white">
                  {data.variable === "precipitation"
                    ? "Precipitation"
                    : "2 m temperature"}{" "}
                  <span className="text-white/50">({data.units})</span>
                </p>
                <p className="text-[11px] text-white/45">
                  {data.members.length} members · {data.model}
                </p>
              </div>
              <SpaghettiChart data={data} />
              <p className="text-[10px] text-white/40">{data.attribution}</p>
            </div>
          ) : null}
        </div>
      </div>
    </SiteShell>
  );
}
