"use client";

import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Gauge,
  MapPin,
  Radar,
  ShieldAlert,
  TrendingUp,
  Wind,
  Waves,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import { SiteShell } from "@/components/site/site-shell";
import { cn } from "@/lib/utils";
import {
  ACTIVE_CYCLONE_PAYLOAD,
  formatWindSpeedKmh,
  type Cyclone,
  type CycloneGroup,
  type CyclonePayload,
} from "@/lib/weather/cyclones";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/50">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function formatMetric(value: number | null, unit: string): string {
  return value === null ? "Not reported" : `${value} ${unit}`;
}

function formatWind(value: number | null): string {
  return value === null ? "Not reported" : formatWindSpeedKmh(value);
}

function CycloneGroupList({
  group,
  cyclones,
  selectedId,
  onSelect,
  status,
  loading,
}: {
  group: CycloneGroup;
  cyclones: Cyclone[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  status: CyclonePayload["sourceStatus"]["australian"];
  loading: boolean;
}) {
  const emptyMessage = loading
    ? "Loading systems…"
    : status === "unavailable" || status === "fallback"
      ? "Live data is unavailable."
      : "No active cyclones reported.";

  return (
    <section className="sw-panel p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-white">{group}</h2>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-white/45">
            {group === "Australian" ? "Bureau of Meteorology" : "NOAA / NHC"}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-white/75">
          {cyclones.length}
        </span>
      </div>
      {cyclones.length ? (
        <div className="space-y-1.5">
          {cyclones.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selectedId === item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                selectedId === item.id
                  ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/10"
                  : "border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-white">{item.name}</span>
                <span className="mt-0.5 block truncate text-xs text-white/55">
                  {item.positionLabel} · {formatWind(item.maxWindKmh)}
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/65">
                {item.category}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/55">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}

const CycloneTrackMap = dynamic(
  async () => {
    const { Circle, CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, ZoomControl, useMap } = await import("react-leaflet");

    function FitCycloneTrack({ cyclone, positions }: { cyclone: Cyclone; positions: Array<[number, number]> }) {
      const map = useMap();

      useEffect(() => {
        map.fitBounds(positions, { padding: [36, 36], maxZoom: 5 });
        map.invalidateSize({ pan: false });

        const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
        resizeObserver.observe(map.getContainer());
        return () => resizeObserver.disconnect();
      }, [cyclone.id, map, positions]);

      return null;
    }

    return function CycloneTrackMapInner({ cyclone }: { cyclone: Cyclone }) {
      if (cyclone.lat === null || cyclone.lon === null) {
        return (
          <div className="flex h-full w-full items-center justify-center bg-[#071a2b] px-6 text-center text-sm text-white/65">
            The advisory does not include a track position.
          </div>
        );
      }

      const trackPoints = cyclone.track.map((point) => [point.lat, point.lon] as [number, number]);
      const stormRadiusKm = Math.max(120, Math.min(350, (cyclone.maxWindKmh ?? 0) * 1.8));
      const mapPositions: Array<[number, number]> = [
        [cyclone.lat, cyclone.lon],
        ...trackPoints,
        ...cyclone.forecastCone,
      ];

      return (
        <MapContainer
          center={[cyclone.lat, cyclone.lon]}
          zoom={5}
          minZoom={3}
          maxZoom={8}
          scrollWheelZoom={false}
          dragging
          className="h-full w-full"
          style={{ background: "#071a2b" }}
          zoomControl={false}
        >
          <FitCycloneTrack cyclone={cyclone} positions={mapPositions} />
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
            maxZoom={19}
            crossOrigin
          />
          <ZoomControl position="topright" />
          {cyclone.forecastCone.length > 2 ? (
            <Polygon
              positions={cyclone.forecastCone}
              pathOptions={{
                color: "#38bdf8",
                weight: 1.5,
                fillColor: "#38bdf8",
                fillOpacity: 0.2,
              }}
            />
          ) : null}
          <Circle
            center={[cyclone.lat, cyclone.lon]}
            radius={stormRadiusKm * 1000}
            pathOptions={{
              color: "rgba(248,113,113,0.8)",
              weight: 1.5,
              fillColor: "rgba(248,113,113,0.15)",
              fillOpacity: 0.2,
            }}
          />
          <Polyline
            positions={trackPoints}
            pathOptions={{
              color: "#7dd3fc",
              weight: 3,
              dashArray: "8 8",
              opacity: 0.9,
            }}
          />
          {cyclone.track.map((point, index) => (
            <CircleMarker
              key={`${point.label}-${point.lat}-${point.lon}`}
              center={[point.lat, point.lon]}
              radius={index === cyclone.track.length - 1 ? 7 : 5}
              pathOptions={{
                color: index >= 3 ? "#fbbf24" : "#f87171",
                weight: 2,
                fillColor: index >= 3 ? "#fbbf24" : "#f87171",
                fillOpacity: 0.9,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -8]}>
                <span className="text-[10px] font-semibold">{point.label}</span>
              </Tooltip>
            </CircleMarker>
          ))}
          <CircleMarker
            center={[cyclone.lat, cyclone.lon]}
            radius={12}
            pathOptions={{
              color: "#f8fafc",
              weight: 2.5,
              fillColor: "#ef4444",
              fillOpacity: 1,
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]}>
              <span className="text-[10px] font-bold">{cyclone.name}</span>
            </Tooltip>
          </CircleMarker>
        </MapContainer>
      );
    };
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#071a2b] text-sm text-white/70">
        Loading cyclone map…
      </div>
    ),
  },
);

export default function CycloneCentrePage() {
  const [data, setData] = useState<CyclonePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/weather/cyclones", { cache: "no-store" });
        if (!res.ok) throw new Error(`Cyclone feed unavailable (${res.status})`);
        const json = (await res.json()) as CyclonePayload;
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setData(ACTIVE_CYCLONE_PAYLOAD);
          setError(err instanceof Error ? err.message : "Cyclone feed failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cyclones = data?.cyclones ?? (loading ? [] : ACTIVE_CYCLONE_PAYLOAD.cyclones);
  const sourceStatus = data?.sourceStatus ?? (loading
    ? { australian: "live", overseas: "live" }
    : ACTIVE_CYCLONE_PAYLOAD.sourceStatus);
  const australianCyclones = cyclones.filter((item) => item.group === "Australian");
  const overseasCyclones = cyclones.filter((item) => item.group === "Overseas");
  const cyclone =
    cyclones.find((item) => item.id === selectedId) ??
    australianCyclones[0] ??
    overseasCyclones[0] ??
    null;

  if (!cyclone) {
    return (
      <SiteShell>
        <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 py-4 text-white sm:px-4 lg:px-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--cyan)]">Tropical cyclones</p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-extrabold text-white">Cyclone centre</h1>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <CycloneGroupList group="Australian" cyclones={australianCyclones} selectedId={selectedId} onSelect={setSelectedId} status={sourceStatus.australian} loading={loading} />
            <CycloneGroupList group="Overseas" cyclones={overseasCyclones} selectedId={selectedId} onSelect={setSelectedId} status={sourceStatus.overseas} loading={loading} />
          </div>
          {error ? <p className="text-sm text-amber-100">Cyclone service unavailable. Try again later.</p> : null}
          {sourceStatus.australian === "fallback" || sourceStatus.overseas === "fallback" ? (
            <p className="text-sm text-amber-100">Live cyclone feeds are unavailable; the saved demo snapshot is being shown.</p>
          ) : null}
          <p className="text-sm text-white/65">
            {loading ? "Checking live cyclone feeds…" : "No cyclone is available to show in the detail view."}
          </p>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell mainClassName="!pb-10">
      <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-4 lg:px-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--cyan)]">
              Tropical cyclones
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Cyclone centre
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
              Active tropical cyclone information, current risks, and practical guidance for communities across Australia.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-[var(--cyan)]/40 hover:text-white"
          >
            <ShieldAlert className="h-3.5 w-3.5 text-[var(--cyan)]" />
            {cyclone.category === "Unclassified" ? "Cyclone advisory" : `${cyclone.category} watch`}
          </button>
        </div>

        {error || sourceStatus.australian !== "live" || sourceStatus.overseas !== "live" ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {sourceStatus.australian === "fallback" || sourceStatus.overseas === "fallback"
              ? "Live cyclone feeds are unavailable; the saved demo snapshot is being shown."
              : "One or more live cyclone feeds are unavailable. Data from the other source may still be shown."}
          </div>
        ) : null}

        <div className="mb-4 grid gap-3 md:grid-cols-5">
          {[
            { label: "Current wind", value: formatWind(cyclone.maxWindKmh), tone: "text-white" },
            { label: "Central pressure", value: formatMetric(cyclone.pressureHpa, "hPa"), tone: "text-cyan-200" },
            { label: "Movement", value: cyclone.movementKmh === null ? cyclone.movementDir : `${cyclone.movementDir} ${cyclone.movementKmh} km/h`, tone: "text-amber-200" },
            { label: "Last update", value: loading ? "Updating…" : new Date(cyclone.lastUpdated).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), tone: "text-rose-200" },
            { label: "Source", value: cyclone.source, tone: "text-emerald-200" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/50">{item.label}</p>
              <p className={`mt-2 text-base font-bold ${item.tone}`}>{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <CycloneGroupList group="Australian" cyclones={australianCyclones} selectedId={cyclone.id} onSelect={setSelectedId} status={sourceStatus.australian} loading={loading} />
          <CycloneGroupList group="Overseas" cyclones={overseasCyclones} selectedId={cyclone.id} onSelect={setSelectedId} status={sourceStatus.overseas} loading={loading} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
          <aside className="sw-panel p-4">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--cyan)]/35 bg-[var(--cyan)]/10 text-[var(--cyan)]">
                <Wind className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/55">Current system</p>
                <p className="text-lg font-extrabold text-white">{cyclone.name}</p>
              </div>
            </div>

            <div className="mb-4 rounded-2xl border border-[var(--cyan)]/20 bg-[var(--cyan)]/8 p-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--cyan)]">Status</p>
              <p className="mt-2 text-xl font-black text-white">{cyclone.category}</p>
              <p className="mt-1 text-sm text-white/80">{cyclone.status}</p>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/10 px-2.5 py-1.5">
                <span className="text-[10px] uppercase tracking-[0.18em] text-rose-100/80">Current severity</span>
                <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-rose-200">
                  {cyclone.category}
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              <Stat label="Location" value={cyclone.positionLabel} />
              <Stat label="Basin" value={cyclone.basin} />
              <Stat label="Max wind" value={formatWind(cyclone.maxWindKmh)} />
              <Stat label="Central pressure" value={formatMetric(cyclone.pressureHpa, "hPa")} />
              <Stat label="Movement" value={cyclone.movementKmh === null ? cyclone.movementDir : `${cyclone.movementDir} ${cyclone.movementKmh} km/h`} />
            </div>

            <div className="mt-5 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3">
              <div className="flex items-center gap-2 text-rose-200">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-xs font-bold uppercase tracking-[0.2em]">Current warning</p>
              </div>
              <p className="mt-2 text-sm font-semibold text-white">{cyclone.warning}</p>
              <p className="mt-3 text-xs leading-relaxed text-rose-100/80">{cyclone.advisoryText}</p>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-xs leading-relaxed text-white/75">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/45">Operational note</p>
              This system is being tracked using the latest available advisory data and public forecast guidance. If conditions change quickly, local warning messages and emergency advice should be treated as the primary source.
            </div>
          </aside>

          <section className="sw-panel overflow-hidden p-2 sm:p-3">
            <div className="relative h-[540px] overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#061728]">
              <div className="absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-full border border-white/10 bg-[#0a1729]/80 px-3 py-1.5 text-xs font-semibold text-white/80 backdrop-blur-sm">
                <MapPin className="h-3.5 w-3.5 text-[var(--cyan)]" />
                {cyclone.positionLabel}
              </div>

              <div className="absolute bottom-3 right-3 z-[500] flex items-center gap-2 rounded-full border border-white/10 bg-[#0a1729]/75 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80 backdrop-blur-sm">
                <Clock3 className="h-3.5 w-3.5 text-[var(--cyan)]" />
                {loading ? "Updating…" : cyclone.lastUpdated}
              </div>

              <div className="absolute bottom-3 left-3 z-[500] max-w-[65%] rounded-full border border-white/10 bg-[#0a1729]/80 px-3 py-1.5 text-[10px] font-semibold text-white/80 backdrop-blur-sm">
                {cyclone.forecastConeSource ?? "Forecast cone not supplied by source"}
              </div>

              <div className="h-full w-full">
                <CycloneTrackMap key={cyclone.id} cyclone={cyclone} />
              </div>
            </div>
          </section>

          <aside className="sw-panel p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--cyan)]/30 bg-[var(--cyan)]/10 text-[var(--cyan)]">
                  <Radar className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Current position</p>
                  <p className="text-xl font-black text-white">{cyclone.name}</p>
                </div>
              </div>
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200">
                {cyclone.category}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/50">Max wind</p>
                <p className="mt-2 text-base font-black text-white">{formatWind(cyclone.maxWindKmh)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/50">Pressure</p>
                <p className="mt-2 text-xl font-black text-white">{formatMetric(cyclone.pressureHpa, "hPa")}</p>
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-white/50">Intensity trend</p>
              <div className="flex items-center gap-2 text-[var(--cyan)]">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-semibold text-white/80">
                  {cyclone.forecastBands.length ? "Forecast profile available" : "Trend not reported"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white/75">{cyclone.summary}</p>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-xs text-white/70">
                <span className="font-semibold uppercase tracking-[0.18em] text-[var(--cyan)]">Operational note</span>
                <p className="mt-2 leading-relaxed text-white/80">{cyclone.advisoryText}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--cyan)]/20 bg-[var(--cyan)]/8 p-3 text-sm text-white/90">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--cyan)]">AI guidance</span>
                <span className="rounded-full border border-[var(--cyan)]/25 bg-[var(--cyan)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--cyan)]">
                  {cyclone.aiConfidence}
                </span>
              </div>
              <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/50">{cyclone.aiSource}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/80">{cyclone.aiSummary}</p>
            </div>

            <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-white/90">
              <div className="flex items-center gap-2 font-bold text-rose-200">
                <AlertTriangle className="h-4 w-4" />
                Current warnings
              </div>
              {cyclone.currentWarnings.length ? (
                <ul className="mt-2 space-y-2 text-sm text-white/90">
                  {cyclone.currentWarnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-400" />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-white/80">No active local warning labels are currently attached to this system.</p>
              )}
            </div>
          </aside>
        </div>

        <div className="mt-5 sw-panel p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[var(--cyan)]">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <h2 className="text-lg font-extrabold text-white">What this means for communities</h2>
            </div>
            <span className="text-xs uppercase tracking-[0.18em] text-white/45">Public guidance</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                title: "Prepare now",
                text: "Secure loose outdoor items, check emergency supplies, and review your local plan if you live in the impact zone.",
              },
              {
                title: "Expect strong conditions",
                text: "Damaging winds, heavy rain, and dangerous surf are the main threats for the next advisory window.",
              },
              {
                title: "Stay alert",
                text: "Conditions can change quickly, so continue watching local warnings and official emergency advice.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--cyan)]">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/80">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 sw-panel p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[var(--cyan)]">
                <MapPin className="h-4 w-4" />
              </div>
              <h2 className="text-lg font-extrabold text-white">Impact zone outlook</h2>
            </div>
            <span className="text-xs uppercase tracking-[0.18em] text-white/45">Regional view</span>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-white">{cyclone.basin}</p>
              <span className="rounded-full border border-[var(--cyan)]/20 bg-[var(--cyan)]/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--cyan)]">
                {cyclone.group} system
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/75">{cyclone.advisoryText}</p>
          </div>
        </div>

        <div className="mt-5 sw-panel p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[var(--cyan)]">
                <Clock3 className="h-4 w-4" />
              </div>
              <h2 className="text-lg font-extrabold text-white">Advisory timeline</h2>
            </div>
            <span className="text-xs uppercase tracking-[0.18em] text-white/45">Next actions</span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              { label: "Current advisory", detail: "This watch remains active and conditions are being monitored closely." },
              { label: "Next review", detail: "A fresh update is expected as the system approaches the next forecast window." },
              { label: "Public action", detail: "Review local plans, secure loose items, and monitor emergency guidance if you are in the risk zone." },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--cyan)]">{item.label}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/75">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="sw-panel p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[var(--cyan)]">
                  <Gauge className="h-4 w-4" />
                </div>
                <h2 className="text-lg font-extrabold text-white">Intensity forecast</h2>
              </div>
              <span className="text-xs uppercase tracking-[0.18em] text-white/45">Next 5 days</span>
            </div>

            {cyclone.forecastBands.length ? (
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {cyclone.forecastBands.map((band, index) => (
                  <div key={band.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-3 h-24 rounded-xl bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.02))] p-2">
                      <div
                        className={cn("h-full rounded-lg", band.tint, index === 0 ? "opacity-95" : "opacity-80")}
                        style={{ height: `${band.heightPct}%` }}
                      />
                    </div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">{band.label}</p>
                    <p className="mt-1 text-sm font-bold text-white">{band.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/60">No intensity forecast was included in the latest advisory.</p>
            )}
          </div>

          <div className="sw-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[var(--cyan)]">
                  <Waves className="h-4 w-4" />
                </div>
                <h2 className="text-lg font-extrabold text-white">AI forecast</h2>
              </div>
              <span className="rounded-full border border-[var(--cyan)]/25 bg-[var(--cyan)]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--cyan)]">
                {cyclone.aiConfidence}
              </span>
            </div>

            <div className="mb-3 rounded-xl border border-[var(--cyan)]/15 bg-[var(--cyan)]/5 p-2.5 text-xs leading-relaxed text-white/80">
              {cyclone.aiSummary}
            </div>

            <div className="space-y-2.5">
              {cyclone.modelRuns.length ? cyclone.modelRuns.map((run) => (
                <div key={run.label} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">{run.label}</p>
                    <p className="mt-1 text-xs text-white/65">{run.hint}</p>
                  </div>
                  <p className="text-sm font-bold text-white">{run.value}</p>
                </div>
              )) : <p className="text-sm text-white/60">No model guidance is available for this system.</p>}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="sw-panel p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[var(--cyan)]">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <h2 className="text-lg font-extrabold text-white">Potential impacts</h2>
              </div>
              <span className="text-xs uppercase tracking-[0.18em] text-white/45">{cyclone.basin}</span>
            </div>

            {cyclone.impacts.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                {cyclone.impacts.map((impact) => (
                  <div key={impact.title} className={cn("rounded-2xl border border-white/10 p-3", impact.tone)}>
                    <p className="text-sm font-bold text-white">{impact.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-white/80">{impact.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/60">No impact summary was included in the latest advisory.</p>
            )}
          </div>

          <div className="sw-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[var(--cyan)]">
                  <Clock3 className="h-4 w-4" />
                </div>
                <h2 className="text-lg font-extrabold text-white">Latest updates</h2>
              </div>
              <ArrowRight className="h-4 w-4 text-white/50" />
            </div>

            <div className="space-y-3">
              {cyclone.updates.map((update) => (
                <div key={`${update.time}-${update.text}`} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[var(--cyan)]" />
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">{update.time}</p>
                    <p className="mt-1 text-sm text-white/80">{update.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
