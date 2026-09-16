"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Gauge,
  Pause,
  Play,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import {
  CAPITAL_NOW,
  HIGHLIGHTS,
  MAP_MODES,
  MODEL_ROWS,
  SYDNEY_NOW,
  WARNINGS,
  WEEK_FORECAST,
  WEATHER_LAYERS,
  type LayerId,
  type MapMode,
} from "@/components/home/mock-data";
import { useWeatherMaps } from "@/hooks/use-weather-maps";
import {
  formatFrameTimeAEST,
  frameIndexToScrub,
  scrubToFrameIndex,
  timelineEdgeLabels,
} from "@/lib/weather/maps";
import { cn } from "@/lib/utils";

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-sm transition",
        on ? "bg-[var(--bom-yellow)]" : "bg-[var(--bom-blue)]/50",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-sm bg-white transition",
          on && "translate-x-4",
        )}
      />
    </button>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border border-[var(--bom-blue)]/20 bg-[var(--bom-blue-mid)] p-3 text-white",
        className,
      )}
    >
      {title ? (
        <h2 className="mb-2.5 border-b border-white/20 pb-1.5 text-sm font-bold tracking-wide text-white">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

function DayIcon({ kind }: { kind: string }) {
  const cls = "h-5 w-5 text-[var(--bom-yellow)]";
  if (kind === "sun") return <Sun className={cls} />;
  if (kind === "rain") return <CloudRain className={cls} />;
  if (kind === "storm") return <CloudLightning className={cls} />;
  if (kind === "cloud") return <Cloud className={cls} />;
  return <CloudSun className={cls} />;
}

function warningTone(tone: string) {
  if (tone === "amber") return "bg-[var(--bom-yellow)] text-[var(--bom-blue)]";
  if (tone === "violet") return "bg-violet-300 text-violet-950";
  if (tone === "cyan") return "bg-cyan-200 text-cyan-950";
  return "bg-sky-200 text-sky-950";
}

export function HomeDashboard() {
  const [layers, setLayers] = useState<Record<LayerId, boolean>>(() => {
    const init = {} as Record<LayerId, boolean>;
    for (const layer of WEATHER_LAYERS) init[layer.id] = false;
    return init;
  });
  const [mode, setMode] = useState<MapMode>("Satellite");
  const [playing, setPlaying] = useState(false);
  const [scrub, setScrub] = useState(100);
  const [frameIndex, setFrameIndex] = useState(0);

  const {
    satelliteFrames,
    loading: mapsLoading,
    error: mapsError,
    satelliteSource,
  } = useWeatherMaps();

  const showLoopUi = mode === "Satellite" || mode === "Radar";
  const showSatelliteLoop = mode === "Satellite";
  const showRadarUi = mode === "Radar";

  const loopFrames = showSatelliteLoop ? satelliteFrames : [];
  const activeFrame = loopFrames[frameIndex] ?? null;

  useEffect(() => {
    if (loopFrames.length === 0) {
      setFrameIndex(0);
      return;
    }
    const next = scrubToFrameIndex(scrub, loopFrames.length);
    setFrameIndex(next);
  }, [scrub, loopFrames.length]);

  useEffect(() => {
    if (loopFrames.length === 0) return;
    setScrub(100);
    setFrameIndex(loopFrames.length - 1);
  }, [loopFrames.length, mode]);

  useEffect(() => {
    if (!playing || !showSatelliteLoop || loopFrames.length === 0) return;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => {
        const next = prev + 1;
        if (next >= loopFrames.length) {
          setPlaying(false);
          setScrub(100);
          return loopFrames.length - 1;
        }
        setScrub(frameIndexToScrub(next, loopFrames.length));
        return next;
      });
    }, 550);
    return () => window.clearInterval(id);
  }, [playing, showSatelliteLoop, loopFrames.length]);

  useEffect(() => {
    if (!playing || !showRadarUi) return;
    const id = window.setInterval(() => {
      setScrub((v) => (v >= 100 ? 0 : v + 2));
    }, 400);
    return () => window.clearInterval(id);
  }, [playing, showRadarUi]);

  useEffect(() => {
    if (!showLoopUi) setPlaying(false);
  }, [showLoopUi]);

  const scrubLabel = useMemo(() => {
    if (showSatelliteLoop) {
      if (mapsLoading && loopFrames.length === 0) return "Loading…";
      if (mapsError && loopFrames.length === 0) return "Unavailable";
      if (!activeFrame) return "No frames";
      return formatFrameTimeAEST(activeFrame.time);
    }
    if (showRadarUi) return "Demo loop";
    return "";
  }, [
    showSatelliteLoop,
    showRadarUi,
    mapsLoading,
    mapsError,
    activeFrame,
    loopFrames.length,
  ]);

  const edgeLabels = useMemo(
    () => timelineEdgeLabels(loopFrames),
    [loopFrames],
  );

  function setLayer(id: LayerId, on: boolean) {
    setLayers((prev) => ({ ...prev, [id]: on }));
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 pb-8 pt-4 sm:px-4">
      <div className="animate-fade-up space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--bom-blue)] sm:text-4xl">
          National overview
        </h1>
        <p className="text-[var(--muted-foreground)] sm:text-lg">
          {SYDNEY_NOW.dateHeading} — Australian weather, observed and forecast.
        </p>
      </div>

      <div className="animate-fade-up-delay grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <Panel title="Map overlays">
            <p className="mb-2 text-[11px] text-white/70">
              Extra layers on top of Map / Satellite / Radar.
            </p>
            <ul className="space-y-2.5">
              {WEATHER_LAYERS.map((layer) => (
                <li
                  key={layer.id}
                  className="flex items-center justify-between gap-2 text-sm text-white/80"
                >
                  <span
                    className={cn(layers[layer.id] && "font-semibold text-white")}
                  >
                    {layer.label}
                  </span>
                  <Toggle
                    label={layer.label}
                    on={layers[layer.id]}
                    onChange={(on) => setLayer(layer.id, on)}
                  />
                </li>
              ))}
            </ul>
          </Panel>

          <div className="border border-[var(--bom-blue)]/20 bg-[var(--bom-blue)] px-3 py-3 text-xs text-white/85">
            <p className="font-bold text-white">Australia-wide coverage</p>
            <p className="mt-1">From tropical coasts to alpine peaks.</p>
          </div>
        </div>

        <div className="flex min-h-[380px] flex-col gap-2 xl:min-h-[520px]">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--bom-blue)]">
              View
            </span>
            {MAP_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "inline-flex items-center gap-0.5 px-2.5 py-1.5 text-xs font-semibold transition sm:text-sm",
                  mode === m
                    ? "bg-[var(--bom-yellow)] text-[var(--bom-blue)]"
                    : "bg-[var(--bom-blue)] text-white hover:bg-[var(--bom-blue-mid)]",
                )}
              >
                <ChevronRight className="h-3.5 w-3.5 opacity-80" aria-hidden />
                {m}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 border-2 border-[var(--bom-blue)] bg-[var(--navy-deep)]">
            <HomeMapDynamic
              mode={mode}
              showRadarOverlay={showRadarUi || layers.rainfall}
              frameTileUrl={
                showSatelliteLoop
                  ? (activeFrame?.tileUrlTemplate ?? null)
                  : null
              }
              frameImageUrl={
                showSatelliteLoop ? (activeFrame?.imageUrl ?? null) : null
              }
              frameImageBounds={
                showSatelliteLoop ? (activeFrame?.imageBounds ?? null) : null
              }
              frameKey={
                showSatelliteLoop && activeFrame
                  ? `${activeFrame.time}-${satelliteSource ?? "wx"}`
                  : undefined
              }
              frameOpacity={1}
              legend={
                showSatelliteLoop && activeFrame
                  ? "satellite"
                  : showRadarUi
                    ? "radar"
                    : null
              }
            />
          </div>

          {showSatelliteLoop ? (
            <div className="flex items-center gap-3 border border-[var(--bom-blue)]/20 bg-[var(--bom-blue-mid)] px-3 py-2.5 text-white">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                disabled={loopFrames.length === 0}
                className="inline-flex h-9 w-9 items-center justify-center bg-[var(--bom-yellow)] text-[var(--bom-blue)] disabled:opacity-40"
                aria-label={playing ? "Pause timeline" : "Play timeline"}
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 translate-x-px" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-white/80">
                  <span className="font-semibold text-white">{scrubLabel}</span>
                  <span>
                    {mapsLoading && loopFrames.length === 0
                      ? "Loading satellite frames…"
                      : mapsError && loopFrames.length === 0
                        ? "Satellite loop unavailable"
                        : "Satellite IR loop"}
                  </span>
                </div>
                {mapsError && loopFrames.length === 0 ? (
                  <p className="text-xs text-[var(--bom-yellow)]">{mapsError}</p>
                ) : (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={scrub}
                      disabled={loopFrames.length === 0}
                      onChange={(e) => {
                        setPlaying(false);
                        setScrub(Number(e.target.value));
                      }}
                      className="w-full accent-[var(--bom-yellow)] disabled:opacity-40"
                      aria-label="Satellite IR timeline"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-white/70">
                      <span>{edgeLabels.start}</span>
                      <span className="hidden sm:inline">{edgeLabels.mid}</span>
                      <span>{edgeLabels.end}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : showRadarUi ? (
            <div className="flex items-center gap-3 border border-[var(--bom-blue)]/20 bg-[var(--bom-blue-mid)] px-3 py-2.5 text-white">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="inline-flex h-9 w-9 items-center justify-center bg-[var(--bom-yellow)] text-[var(--bom-blue)]"
                aria-label={playing ? "Pause timeline" : "Play timeline"}
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 translate-x-px" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between text-xs text-white/80">
                  <span className="font-semibold text-white">{scrubLabel}</span>
                  <span>Radar loop (demo)</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={scrub}
                  onChange={(e) => {
                    setPlaying(false);
                    setScrub(Number(e.target.value));
                  }}
                  className="w-full accent-[var(--bom-yellow)]"
                  aria-label="Radar timeline"
                />
                <p className="mt-1 text-[10px] text-white/70">
                  Live radar tiles land in a later pass — demo cells only for now.
                </p>
              </div>
            </div>
          ) : (
            <p className="border border-[var(--bom-blue)]/15 bg-white px-3 py-2 text-xs text-[var(--muted-foreground)]">
              Select{" "}
              <span className="font-semibold text-[var(--bom-blue)]">Satellite</span>{" "}
              for the infrared loop, or{" "}
              <span className="font-semibold text-[var(--bom-blue)]">Radar</span> for
              the demo playback strip. Overlays on the left can be mixed with Map.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Panel>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-bold text-white">{SYDNEY_NOW.place}</p>
                <p className="text-xs text-white/70">{SYDNEY_NOW.clockLabel}</p>
              </div>
              <CloudSun className="h-10 w-10 text-[var(--bom-yellow)]" />
            </div>
            <p className="mt-1 text-4xl font-bold text-white">
              {SYDNEY_NOW.tempC}°C
            </p>
            <p className="text-sm text-white/80">{SYDNEY_NOW.condition}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {[
                ["Feels like", `${SYDNEY_NOW.feelsLikeC}°C`],
                ["Humidity", `${SYDNEY_NOW.humidityPct}%`],
                ["Wind", SYDNEY_NOW.wind],
                ["Gusts", SYDNEY_NOW.gusts],
                ["Rain (today)", `${SYDNEY_NOW.rainTodayMm} mm`],
                ["Pressure", `${SYDNEY_NOW.pressureHpa} hPa`],
              ].map(([k, v]) => (
                <div key={k} className="bg-[var(--bom-blue)]/50 px-2 py-1.5">
                  <p className="text-white/70">{k}</p>
                  <p className="font-bold text-white">{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-3 border-t border-white/15 pt-2 text-xs text-white/85">
              <span>
                Min{" "}
                <strong className="text-white">{SYDNEY_NOW.minC}°</strong>
              </span>
              <span>
                Max{" "}
                <strong className="text-[var(--bom-yellow)]">
                  {SYDNEY_NOW.maxC}°
                </strong>
              </span>
              <span>
                Rain chance{" "}
                <strong className="text-white">{SYDNEY_NOW.rainChancePct}%</strong>
              </span>
              <span>
                UV <strong className="text-white">{SYDNEY_NOW.uv}</strong>
              </span>
            </div>
          </Panel>

          <Panel title="Severe Weather Warnings">
            <ul className="space-y-2">
              {WARNINGS.map((w) => (
                <li
                  key={w.id}
                  className="flex gap-2 bg-[var(--bom-blue)]/40 p-2"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center",
                      warningTone(w.tone),
                    )}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-white">{w.title}</p>
                    <p className="text-xs text-white/75">{w.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link
              href="/severe-weather"
              className="mt-2 inline-block text-xs font-semibold text-[var(--bom-yellow)] hover:underline"
            >
              All warnings →
            </Link>
          </Panel>

          <Panel title="Storm Tracker">
            <div className="overflow-hidden border border-white/20">
              <div
                className="flex h-24 items-end justify-center bg-[linear-gradient(135deg,#001a3a,#003087)] p-2"
                aria-hidden
              >
                <div className="h-16 w-28 rounded-full bg-[radial-gradient(circle_at_40%_40%,#ef4444_0%,#eab308_35%,#22c55e_65%,transparent_70%)] opacity-90" />
              </div>
              <div className="space-y-1 bg-[var(--bom-blue)]/60 p-2 text-xs">
                <p className="font-bold text-white">Storm 1427 · eastern NSW</p>
                <p className="text-white/75">Moving SE · 28 km/h</p>
                <p className="text-white/75">Lightning 12/min · Hail: Large</p>
                <p className="text-white/75">Max wind 95 km/h · Rain 42 mm/h</p>
              </div>
            </div>
          </Panel>

          <Panel title="Briefing notes">
            <ul className="space-y-2">
              {HIGHLIGHTS.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-white/85">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--bom-yellow)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title={`Capital cities — ${SYDNEY_NOW.dateHeading}`}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {CAPITAL_NOW.map((c) => (
            <div
              key={c.city}
              className="bg-[var(--bom-blue)]/45 px-2 py-2 text-center"
            >
              <p className="text-xs font-bold text-white">{c.city}</p>
              <p className="text-xl font-bold text-[var(--bom-yellow)]">
                {c.tempC}°
              </p>
              <p className="text-[10px] text-white/75">{c.wind}</p>
              <p className="text-[10px] text-white/70">{c.condition}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="7 Day Forecast — Sydney">
          <div className="flex justify-between gap-1 overflow-x-auto">
            {WEEK_FORECAST.map((d) => (
              <div
                key={d.day}
                className="flex min-w-[2.6rem] flex-col items-center gap-1 text-center text-xs"
              >
                <span className="text-white/70">{d.day}</span>
                <DayIcon kind={d.icon} />
                <span className="font-bold text-[var(--bom-yellow)]">
                  {d.high}°
                </span>
                <span className="text-white/80">{d.low}°</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Model Comparison — Sydney">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[240px] text-left text-xs">
              <thead className="text-white/70">
                <tr>
                  <th className="pb-2 font-semibold">Metric</th>
                  <th className="pb-2 font-semibold">ECMWF</th>
                  <th className="pb-2 font-semibold">ACCESS</th>
                  <th className="pb-2 font-semibold">GFS</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_ROWS.map((row) => (
                  <tr key={row.metric} className="border-t border-white/15">
                    <td className="py-1.5 text-white/75">{row.metric}</td>
                    <td className="py-1.5 font-semibold text-white">
                      {row.ecmwf}
                    </td>
                    <td className="py-1.5 font-semibold text-white">
                      {row.access}
                    </td>
                    <td className="py-1.5 font-semibold text-white">{row.gfs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Upper air — Sydney (demo)">
          <div className="relative h-36 overflow-hidden border border-white/20 bg-[var(--navy-deep)]">
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
              <path
                d="M40 100 C70 90, 90 40, 120 35 S160 50, 175 20"
                fill="none"
                stroke="#1a6bb5"
                strokeWidth="2"
              />
              <path
                d="M40 105 C80 95, 100 70, 130 55 S165 45, 175 40"
                fill="none"
                stroke="#ffe000"
                strokeWidth="2"
              />
            </svg>
            <div className="absolute bottom-2 left-2 flex gap-3 text-[10px] text-white/80">
              <span className="inline-flex items-center gap-1">
                <Gauge className="h-3 w-3 text-[var(--bom-yellow)]" /> LI −2
              </span>
              <span>CIN 45</span>
              <span>Shear 35 kt</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
