"use client";

import { useMemo } from "react";
import { CloudLightning, Gauge } from "lucide-react";
import {
  useModelComparison,
  useStormActivity,
  useUpperAir,
} from "@/hooks/use-home-insight";

function PanelShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-white/15 bg-[var(--bom-blue-mid)] p-3 text-[var(--ink)]">
      <h2 className="mb-2.5 border-b border-white/15 pb-1.5 text-sm font-bold tracking-wide text-[var(--ink)]">
        {title}
      </h2>
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
      className="grid h-24 w-full gap-px bg-[#001a3a]"
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

export function HomeStormTrackerPanel() {
  const { data, loading, error } = useStormActivity();
  const top = data?.hotspots[0] ?? null;

  return (
    <PanelShell title="Storm Tracker">
      {loading && !data ? (
        <p className="text-sm text-white/70">Scanning lightning network…</p>
      ) : null}
      {error && !data ? (
        <p className="text-sm text-white/80">{error}</p>
      ) : null}
      {data ? (
        <div className="overflow-hidden border border-[var(--ink)]/20">
          <StormDensityMap
            cells={data.grid.cells}
            cols={data.grid.cols}
            rows={data.grid.rows}
          />
          <div className="space-y-1 bg-[var(--ink)]/10 p-2 text-xs">
            {top ? (
              <>
                <p className="flex items-center gap-1.5 font-bold text-[var(--ink)]">
                  <CloudLightning className="h-3.5 w-3.5 text-[var(--bom-yellow)]" />
                  Active · {top.label}
                </p>
                <p className="text-[var(--ink)]/75">
                  {top.ratePerMin} /min · {top.strikes15m} strikes (15 min)
                </p>
                <p className="text-[var(--ink)]/75">
                  {top.strikes60m} in the last hour · peak {top.maxIntensity} kA
                </p>
              </>
            ) : (
              <p className="font-bold text-[var(--ink)]">
                No strong lightning clusters in the last hour
              </p>
            )}
            <p className="text-[var(--ink)]/60">
              National {data.total15m} strikes / 15 min · {data.total60m} / hour
            </p>
            {data.hotspots.length > 1 ? (
              <p className="text-[var(--ink)]/65">
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
  const { data, loading, error } = useModelComparison();

  return (
    <PanelShell title="Model Comparison — Sydney">
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
              <thead className="text-[var(--ink)]/70">
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
                    className="border-t border-[var(--ink)]/15"
                  >
                    <td className="py-1.5 text-[var(--ink)]/75">{row.metric}</td>
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
          <p className="mt-2 text-[10px] text-white/50">{data.attribution}</p>
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

  return (
    <PanelShell title="Upper air — Sydney">
      {loading && !data ? (
        <p className="text-sm text-white/70">Loading upper-air profile…</p>
      ) : null}
      {error && !data ? (
        <p className="text-sm text-white/80">{error}</p>
      ) : null}
      {data ? (
        <>
          <div className="relative h-36 overflow-hidden border border-[var(--ink)]/20 bg-[var(--navy-deep)]">
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
                <Gauge className="h-3 w-3 text-[var(--bom-yellow)]" />
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
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-white/75">
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
          <p className="mt-1 text-[10px] text-white/50">{data.attribution}</p>
        </>
      ) : null}
    </PanelShell>
  );
}
