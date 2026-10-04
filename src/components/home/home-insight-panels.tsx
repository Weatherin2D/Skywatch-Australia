"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CloudLightning, Gauge, Share2 } from "lucide-react";
import {
  useModelComparison,
  useStormActivity,
  useUpperAir,
} from "@/hooks/use-home-insight";
import { useSavedPlace } from "@/hooks/use-saved-place";
import { STATE_CAPITALS } from "@/lib/weather/location-forecast";
import { absoluteAppUrl, shareContent } from "@/lib/share";
import { buildSkywatchMoment } from "@/lib/weather/skywatch-moment";
import { cn } from "@/lib/utils";

function PanelShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sw-panel p-3 text-[var(--ink)] sm:p-3.5">
      <h2 className="sw-panel-title">{title}</h2>
      {children}
    </section>
  );
}

function StormDensityMap({
  cells,
  cols,
  rows,
}: {
  cells: number[];
  cols: number;
  rows: number;
}) {
  const max = Math.max(1, ...cells);
  return (
    <div
      className="grid h-20 w-full gap-px rounded-md bg-[#001a3a] sm:h-24"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
      aria-hidden
    >
      {cells.map((n, i) => {
        const t = n / max;
        const bg =
          n <= 0
            ? "transparent"
            : `rgba(255, ${Math.round(220 - t * 160)}, ${Math.round(40 + (1 - t) * 40)}, ${0.25 + t * 0.75})`;
        return (
          <span
            key={i}
            style={{ background: bg }}
            className="min-h-0 min-w-0"
          />
        );
      })}
    </div>
  );
}

export function HomeMomentCard() {
  const { place } = useSavedPlace();
  const name = place?.name ?? STATE_CAPITALS.nsw.name;
  const lat = place?.lat ?? -33.87;
  const lon = place?.lon ?? 151.21;
  const { data: storm, loading: stormLoading } = useStormActivity();
  const { data: models, loading: modelsLoading } = useModelComparison(
    lat,
    lon,
    name,
  );
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied">(
    "idle",
  );

  const moment = useMemo(
    () =>
      buildSkywatchMoment({
        placeName: name,
        storm,
        models,
      }),
    [name, storm, models],
  );

  const loading = (stormLoading && !storm) || (modelsLoading && !models);

  async function onShare() {
    const result = await shareContent({
      title: "SkyWatch Australia",
      text: moment.shareText,
      url: absoluteAppUrl(moment.href),
    });
    if (result === "shared" || result === "copied") {
      setShareState(result);
      window.setTimeout(() => setShareState("idle"), 2000);
    }
  }

  const moodGlow =
    moment.mood === "storm"
      ? "from-violet-500/25 via-cyan-400/10 to-transparent"
      : moment.mood === "rain"
        ? "from-sky-500/25 via-blue-400/10 to-transparent"
        : moment.mood === "heat"
          ? "from-amber-500/25 via-orange-400/10 to-transparent"
          : "from-cyan-500/20 via-teal-400/10 to-transparent";

  return (
    <section
      className={cn(
        "animate-fade-up relative overflow-hidden rounded-2xl border border-white/12 bg-[#0a1224] p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.35)]",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90",
          moodGlow,
        )}
        aria-hidden
      />
      <div className="relative space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
            {moment.eyebrow}
          </p>
          <button
            type="button"
            onClick={() => void onShare()}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white/85 transition hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)]"
          >
            <Share2 className="h-3 w-3" aria-hidden />
            {shareState === "copied"
              ? "Copied"
              : shareState === "shared"
                ? "Shared"
                : "Share"}
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-white/65">Writing today’s moment…</p>
        ) : (
          <>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold leading-tight text-white sm:text-2xl">
              {moment.headline}
            </h2>
            <p className="text-sm text-white/70">{moment.detail}</p>
            <Link
              href={moment.href}
              className="inline-flex text-xs font-semibold text-[var(--cyan)] hover:underline"
            >
              Open on SkyWatch →
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

export function HomeStormTrackerPanel() {
  const { data, loading, error } = useStormActivity();
  const top = data?.hotspots[0] ?? null;

  return (
    <PanelShell title="Storm tracker">
      {loading && !data ? (
        <p className="text-sm text-white/70">Scanning lightning network…</p>
      ) : null}
      {error && !data ? (
        <p className="text-sm text-white/80">{error}</p>
      ) : null}
      {data ? (
        <div className="overflow-hidden rounded-md border border-[var(--ink)]/15">
          <StormDensityMap
            cells={data.grid.cells}
            cols={data.grid.cols}
            rows={data.grid.rows}
          />
          <div className="space-y-2 bg-[var(--ink)]/8 p-2.5 text-xs">
            {top ? (
              <>
                <p className="flex items-center gap-1.5 font-bold text-[var(--ink)]">
                  <CloudLightning className="h-3.5 w-3.5 text-[var(--cyan)]" />
                  Active · {top.label}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-md bg-black/20 px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-white/50">
                      Rate
                    </p>
                    <p className="font-semibold text-white">
                      {top.ratePerMin}/min
                    </p>
                  </div>
                  <div className="rounded-md bg-black/20 px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-white/50">
                      15 min
                    </p>
                    <p className="font-semibold text-white">
                      {top.strikes15m} strikes
                    </p>
                  </div>
                  <div className="rounded-md bg-black/20 px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-white/50">
                      Last hour
                    </p>
                    <p className="font-semibold text-white">{top.strikes60m}</p>
                  </div>
                  <div className="rounded-md bg-black/20 px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-white/50">
                      Peak
                    </p>
                    <p className="font-semibold text-white">
                      {top.maxIntensity} kA
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="font-bold text-[var(--ink)]">
                No strong lightning clusters in the last hour
              </p>
            )}
            <p className="text-[var(--ink)]/55">
              National {data.total15m} / 15 min · {data.total60m} / hour
            </p>
            {data.hotspots.length > 1 ? (
              <p className="line-clamp-2 text-[var(--ink)]/60">
                Also:{" "}
                {data.hotspots
                  .slice(1)
                  .map((h) => `${h.label} (${h.strikes15m})`)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </PanelShell>
  );
}

export function HomeModelComparisonPanel() {
  const { place } = useSavedPlace();
  const lat = place?.lat ?? -33.87;
  const lon = place?.lon ?? 151.21;
  const name = place?.name ?? STATE_CAPITALS.nsw.name;
  const { data, loading, error } = useModelComparison(lat, lon, name);

  return (
    <PanelShell title={`Model comparison — ${name}`}>
      {loading && !data ? (
        <p className="text-sm text-white/70">Loading model guidance…</p>
      ) : null}
      {error && !data ? (
        <p className="text-sm text-white/80">{error}</p>
      ) : null}
      {data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[240px] text-left text-xs">
              <thead className="text-[var(--ink)]/65">
                <tr>
                  <th className="pb-2 font-semibold">Metric</th>
                  <th className="pb-2 font-semibold">ECMWF</th>
                  <th className="pb-2 font-semibold">ICON</th>
                  <th className="pb-2 font-semibold">GFS</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.metric}
                    className="border-t border-[var(--ink)]/12"
                  >
                    <td className="py-1.5 text-[var(--ink)]/70">{row.metric}</td>
                    <td className="py-1.5 font-semibold text-[var(--ink)]">
                      {row.ecmwf}
                    </td>
                    <td className="py-1.5 font-semibold text-[var(--ink)]">
                      {row.icon}
                    </td>
                    <td className="py-1.5 font-semibold text-[var(--ink)]">
                      {row.gfs}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-white/45">{data.attribution}</p>
        </>
      ) : null}
    </PanelShell>
  );
}

export function HomeUpperAirPanel() {
  const { data, loading, error } = useUpperAir();

  const path = useMemo(() => {
    if (!data?.profile?.length) return "";
    const temps = data.profile
      .map((p) => p.tempC)
      .filter((t): t is number => t != null);
    if (temps.length < 2) return "";
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const span = Math.max(1, maxT - minT);
    const pts = data.profile
      .map((p, i) => {
        if (p.tempC == null) return null;
        const x = 40 + ((p.tempC - minT) / span) * 130;
        const y = 18 + i * 20;
        return `${x},${y}`;
      })
      .filter(Boolean);
    return pts.length ? `M${pts.join(" L")}` : "";
  }, [data]);

  const validLabel = useMemo(() => {
    if (!data?.validTime) return null;
    const d = new Date(data.validTime);
    if (!Number.isFinite(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d) + " UTC";
  }, [data?.validTime]);

  return (
    <PanelShell title="Upper air — Sydney">
      {loading && !data ? (
        <p className="text-sm text-white/70">Loading Sydney radiosonde…</p>
      ) : null}
      {error && !data ? (
        <p className="text-sm text-white/80">{error}</p>
      ) : null}
      {data?.status === "empty" ? (
        <p className="text-sm text-white/80">
          {data.message ?? "No recent Sydney Airport sounding."}
        </p>
      ) : null}
      {data && data.status !== "empty" ? (
        <>
          <div className="relative h-36 overflow-hidden rounded-md border border-[var(--ink)]/15 bg-[#001a3a]">
            <svg viewBox="0 0 200 120" className="h-full w-full opacity-90">
              <rect width="200" height="120" fill="#001a3a" />
              {[20, 40, 60, 80, 100].map((y) => (
                <line
                  key={y}
                  x1="30"
                  x2="180"
                  y1={y}
                  y2={y}
                  stroke="#1a4a8c"
                  strokeWidth="1"
                />
              ))}
              {data.profile.map((p, i) => (
                <text
                  key={p.label}
                  x="8"
                  y={22 + i * 20}
                  fill="#8eb4e8"
                  fontSize="8"
                >
                  {p.label}
                </text>
              ))}
              {path ? (
                <path
                  d={path}
                  fill="none"
                  stroke="#ffe000"
                  strokeWidth="2"
                />
              ) : null}
            </svg>
            <div className="absolute bottom-2 left-2 flex flex-wrap gap-3 text-[10px] text-[var(--ink)]/80">
              <span className="inline-flex items-center gap-1">
                <Gauge className="h-3 w-3 text-[var(--cyan)]" />
                CAPE {data.cape != null ? Math.round(data.cape) : "—"}
              </span>
              <span>CIN {data.cin != null ? Math.round(data.cin) : "—"}</span>
              <span>
                Shear{" "}
                {data.shearKmh != null
                  ? `${Math.round(data.shearKmh)} km/h`
                  : "—"}
              </span>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-white/70">
            <span>
              500 hPa{" "}
              <strong className="text-white">
                {data.height500m != null
                  ? `${Math.round(data.height500m)} m`
                  : "—"}
              </strong>
            </span>
            <span>
              850 hPa{" "}
              <strong className="text-white">
                {data.temp850C != null ? `${data.temp850C.toFixed(1)}°C` : "—"}
              </strong>
            </span>
            <span>
              500 hPa{" "}
              <strong className="text-white">
                {data.temp500C != null ? `${data.temp500C.toFixed(1)}°C` : "—"}
              </strong>
            </span>
            <span>
              RH 850{" "}
              <strong className="text-white">
                {data.rh850Pct != null ? `${Math.round(data.rh850Pct)}%` : "—"}
              </strong>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-white/45">
              {data.attribution}
              {validLabel ? ` · ${validLabel}` : ""}
            </p>
            <Link
              href="/soundings"
              className="text-[10px] font-semibold text-[var(--cyan)] hover:underline"
            >
              Full sounding
            </Link>
          </div>
        </>
      ) : null}
    </PanelShell>
  );
}
