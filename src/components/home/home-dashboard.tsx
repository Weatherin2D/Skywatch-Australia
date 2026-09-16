"use client";

import {
  AlertTriangle,
  ChevronDown,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import {
  CAPITAL_NOW,
  DEFAULT_MAP_SETTINGS,
  HIGHLIGHTS,
  MAP_MODES,
  MAP_SETTINGS,
  MODEL_ROWS,
  SYDNEY_NOW,
  WARNINGS,
  WEEK_FORECAST,
  WEATHER_LAYERS,
  type LayerId,
  type MapMode,
  type MapSettingId,
  type MapSettingsState,
} from "@/components/home/mock-data";
import { useWeatherMaps } from "@/hooks/use-weather-maps";
import { useFramePreloader } from "@/hooks/use-frame-preloader";
import { useLightning } from "@/hooks/use-lightning";
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SATELLITE_PRODUCT,
  PLAYBACK_SPEEDS,
  SATELLITE_PRODUCTS,
  formatFrameTimeAEST,
  frameIndexToScrub,
  getPlaybackSpeed,
  getSatelliteProduct,
  scrubToFrameIndex,
  timelineEdgeLabels,
  type PlaybackSpeedId,
  type SatelliteProductId,
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
        on ? "bg-[var(--bom-yellow)]" : "bg-white/25",
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
        "border border-white/15 bg-[var(--bom-blue-mid)] p-3 text-[var(--ink)]",
        className,
      )}
    >
      {title ? (
        <h2 className="mb-2.5 border-b border-white/15 pb-1.5 text-sm font-bold tracking-wide text-[var(--ink)]">
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
  if (tone === "amber") return "bg-[var(--bom-yellow)] text-[var(--brand)]";
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
  const [mapSettings, setMapSettings] =
    useState<MapSettingsState>(DEFAULT_MAP_SETTINGS);
  const [mode, setMode] = useState<MapMode>("Satellite");
  const [satProduct, setSatProduct] = useState<SatelliteProductId>(
    DEFAULT_SATELLITE_PRODUCT,
  );
  const [satMenuOpen, setSatMenuOpen] = useState(false);
  const satMenuRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [radarScrub, setRadarScrub] = useState(100);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeedId>(
    DEFAULT_PLAYBACK_SPEED,
  );
  const frameIndexRef = useRef(0);
  frameIndexRef.current = frameIndex;

  const {
    satelliteFrames,
    loading: mapsLoading,
    error: mapsError,
    satelliteSource,
  } = useWeatherMaps(satProduct);

  const showLightning = layers.lightning;
  const {
    strikes: lightningStrikes,
    attribution: lightningAttribution,
  } = useLightning(showLightning);

  const satProductMeta = getSatelliteProduct(satProduct);
  const playback = getPlaybackSpeed(playbackSpeed);
  const showLoopUi = mode === "Satellite" || mode === "Radar";
  const showSatelliteLoop = mode === "Satellite";
  const showRadarUi = mode === "Radar";

  const loopFrames = showSatelliteLoop ? satelliteFrames : [];
  const activeFrame = loopFrames[frameIndex] ?? null;
  const scrub =
    loopFrames.length > 0
      ? frameIndexToScrub(frameIndex, loopFrames.length)
      : 100;

  const {
    readyCount,
    total: preloadTotal,
    isUrlReady,
  } = useFramePreloader(loopFrames, showSatelliteLoop);
  const readyGateRef = useRef({ isUrlReady });
  readyGateRef.current = { isUrlReady };

  // Jump to latest frame when the product/mode loop set changes
  useEffect(() => {
    if (loopFrames.length === 0) {
      setFrameIndex(0);
      return;
    }
    setPlaying(false);
    setFrameIndex(loopFrames.length - 1);
  }, [loopFrames.length, mode, satProduct]);

  // Ready-gated satellite playback: advance only when the next frame is cached
  useEffect(() => {
    if (!playing || !showSatelliteLoop || loopFrames.length === 0) return;

    let cancelled = false;
    let timer = 0;

    const schedule = (delay: number, fn: () => void) => {
      timer = window.setTimeout(fn, delay);
    };

    const tick = () => {
      if (cancelled) return;
      const prev = frameIndexRef.current;
      let next = (prev + 1) % loopFrames.length;
      // Prefer the immediate next frame; if it is not ready yet, wait on it
      // rather than skipping ahead (so every frame is shown once cached).
      const url = loopFrames[next]?.imageUrl;

      const apply = () => {
        if (cancelled) return;
        setFrameIndex(next);
        schedule(playback.msPerFrame, tick);
      };

      if (!url || readyGateRef.current.isUrlReady(url)) {
        apply();
        return;
      }

      const img = new window.Image();
      let settled = false;
      const finish = () => {
        if (settled || cancelled) return;
        settled = true;
        apply();
      };
      const wait = window.setTimeout(finish, Math.max(playback.msPerFrame * 3, 1500));
      img.onload = () => {
        window.clearTimeout(wait);
        if (typeof img.decode === "function") {
          void img.decode().then(finish).catch(finish);
        } else {
          finish();
        }
      };
      img.onerror = () => {
        window.clearTimeout(wait);
        // Skip broken frame
        next = (next + 1) % loopFrames.length;
        finish();
      };
      img.src = url;
    };

    schedule(playback.msPerFrame, tick);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [playing, showSatelliteLoop, loopFrames, playback.msPerFrame]);

  useEffect(() => {
    if (!playing || !showRadarUi) return;
    const step = Math.max(1, Math.round(2 * (500 / playback.msPerFrame)));
    const id = window.setInterval(() => {
      setRadarScrub((v) => (v >= 100 ? 0 : Math.min(100, v + step)));
    }, playback.msPerFrame);
    return () => window.clearInterval(id);
  }, [playing, showRadarUi, playback.msPerFrame]);

  useEffect(() => {
    if (!showLoopUi) setPlaying(false);
  }, [showLoopUi]);

  useEffect(() => {
    if (!satMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!satMenuRef.current?.contains(e.target as Node)) {
        setSatMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSatMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [satMenuOpen]);

  const scrubLabel = useMemo(() => {
    if (showSatelliteLoop) {
      if (mapsLoading && loopFrames.length === 0) return "Loading…";
      if (mapsError && loopFrames.length === 0) return "Unavailable";
      if (!activeFrame) {
        if (satProductMeta.daytimeOnly) return "No daytime frames";
        return "No frames";
      }
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
    satProductMeta.daytimeOnly,
  ]);

  const edgeLabels = useMemo(
    () => timelineEdgeLabels(loopFrames),
    [loopFrames],
  );

  const loopStatusLabel = useMemo(() => {
    if (mapsLoading && loopFrames.length === 0) return "Loading satellite frames…";
    if (loopFrames.length === 0) {
      if (satProductMeta.daytimeOnly) {
        return "Visible unavailable for this period";
      }
      return mapsError ? "Satellite loop unavailable" : "No frames available";
    }
    if (preloadTotal > 0 && readyCount < preloadTotal) {
      return `Caching ${readyCount}/${preloadTotal} · ${satProductMeta.loopLabel}`;
    }
    return satProductMeta.loopLabel;
  }, [
    mapsLoading,
    mapsError,
    loopFrames.length,
    satProductMeta.daytimeOnly,
    satProductMeta.loopLabel,
    preloadTotal,
    readyCount,
  ]);

  function setLayer(id: LayerId, on: boolean) {
    setLayers((prev) => ({ ...prev, [id]: on }));
  }

  function setMapSetting(id: MapSettingId, on: boolean) {
    setMapSettings((prev) => ({ ...prev, [id]: on }));
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
            <p className="mb-2 text-[11px] text-[var(--ink)]/70">
              Extra layers on top of Map / Satellite / Radar.
            </p>
            <ul className="space-y-2.5">
              {WEATHER_LAYERS.map((layer) => (
                <li
                  key={layer.id}
                  className="flex items-center justify-between gap-2 text-sm text-[var(--ink)]/80"
                >
                  <span
                    className={cn(layers[layer.id] && "font-semibold text-[var(--ink)]")}
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

          <Panel title="Map Settings">
            <p className="mb-2 text-[11px] text-[var(--ink)]/70">
              Cartography drawn over the national map.
            </p>
            <ul className="space-y-2.5">
              {MAP_SETTINGS.map((setting) => (
                <li
                  key={setting.id}
                  className="flex items-center justify-between gap-2 text-sm text-[var(--ink)]/80"
                >
                  <span
                    className={cn(
                      mapSettings[setting.id] && "font-semibold text-[var(--ink)]",
                    )}
                  >
                    {setting.label}
                  </span>
                  <Toggle
                    label={setting.label}
                    on={mapSettings[setting.id]}
                    onChange={(on) => setMapSetting(setting.id, on)}
                  />
                </li>
              ))}
            </ul>
          </Panel>

          <div className="border border-white/20 bg-[var(--bom-blue)] px-3 py-3 text-xs text-[var(--brand)]/85">
            <p className="font-bold text-[var(--brand)]">Australia-wide coverage</p>
            <p className="mt-1">From tropical coasts to alpine peaks.</p>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-white/80">
              View
            </span>
            {MAP_MODES.map((m) => {
              if (m === "Satellite") {
                return (
                  <div key={m} className="relative" ref={satMenuRef}>
                    <button
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={satMenuOpen}
                      onClick={() => {
                        if (mode === "Satellite") {
                          setSatMenuOpen((open) => !open);
                        } else {
                          setMode("Satellite");
                          setSatMenuOpen(true);
                        }
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition sm:text-sm",
                        mode === "Satellite"
                          ? "bg-[var(--bom-yellow)] text-[var(--brand)]"
                          : "bg-[var(--bom-blue)] text-[var(--brand)] hover:bg-[var(--navy-deep)]",
                      )}
                    >
                      <ChevronRight
                        className="h-3.5 w-3.5 opacity-80"
                        aria-hidden
                      />
                      Satellite
                      <span className="hidden font-normal opacity-80 sm:inline">
                        · {satProductMeta.label}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 opacity-80 transition",
                          satMenuOpen && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </button>
                    {satMenuOpen ? (
                      <ul
                        role="listbox"
                        aria-label="Satellite product"
                        className="absolute left-0 top-full z-30 mt-1 max-h-72 min-w-[13rem] overflow-y-auto border border-[var(--brand)]/15 bg-[var(--bom-blue)] py-1 text-[var(--brand)] shadow-lg"
                      >
                        {SATELLITE_PRODUCTS.map((p) => (
                          <li key={p.id} role="option" aria-selected={satProduct === p.id}>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center px-3 py-2 text-left text-sm font-semibold text-[var(--brand)] transition",
                                satProduct === p.id
                                  ? "bg-[var(--bom-yellow)]"
                                  : "hover:bg-[var(--navy-deep)]",
                              )}
                              onClick={() => {
                                setSatProduct(p.id);
                                setMode("Satellite");
                                setSatMenuOpen(false);
                              }}
                            >
                              {p.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              }

              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setSatMenuOpen(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-0.5 px-2.5 py-1.5 text-xs font-semibold transition sm:text-sm",
                    mode === m
                      ? "bg-[var(--bom-yellow)] text-[var(--brand)]"
                      : "bg-[var(--bom-blue)] text-[var(--brand)] hover:bg-[var(--navy-deep)]",
                  )}
                >
                  <ChevronRight className="h-3.5 w-3.5 opacity-80" aria-hidden />
                  {m}
                </button>
              );
            })}
          </div>

          <div
            className={cn(
              "border-2 border-white/40 bg-[var(--navy-deep)]",
              showSatelliteLoop
                ? "w-full overflow-hidden bg-black"
                : "min-h-[360px] flex-1 bg-black",
            )}
          >
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
                  ? `${satProduct}-${activeFrame.time}-${satelliteSource ?? "wx"}`
                  : undefined
              }
              frameOpacity={1}
              frameAlt={`${satProductMeta.label} satellite loop frame`}
              legend={showRadarUi ? "radar" : null}
              mapSettings={mapSettings}
              showLightning={showLightning}
              lightningStrikes={lightningStrikes}
              lightningAttribution={lightningAttribution}
            />
          </div>

          {showSatelliteLoop ? (
            <div className="flex items-center gap-3 border border-white/25 bg-[var(--bom-blue)] px-3 py-2.5 text-[var(--brand)]">
              <button
                type="button"
                onClick={() => {
                  setPlaying((p) => {
                    if (!p && loopFrames.length > 0) {
                      // Start (or restart) from the first frame when at the end
                      if (frameIndex >= loopFrames.length - 1) {
                        setFrameIndex(0);
                      }
                      return true;
                    }
                    return !p;
                  });
                }}
                disabled={loopFrames.length === 0 || readyCount === 0}
                className="inline-flex h-9 w-9 items-center justify-center bg-[var(--bom-yellow)] text-[var(--brand)] disabled:opacity-40"
                aria-label={playing ? "Pause timeline" : "Play timeline"}
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 translate-x-px" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--brand)]/80">
                  <span className="font-semibold text-[var(--brand)]">{scrubLabel}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="hidden sm:inline">{loopStatusLabel}</span>
                    {loopFrames.length > 0 ? (
                      <span className="text-[10px] text-[var(--brand)]/65">
                        Frame {frameIndex + 1}/{loopFrames.length}
                      </span>
                    ) : null}
                    <div
                      className="inline-flex items-center gap-0.5"
                      role="group"
                      aria-label="Animation speed"
                    >
                      {PLAYBACK_SPEEDS.map((speed) => (
                        <button
                          key={speed.id}
                          type="button"
                          onClick={() => setPlaybackSpeed(speed.id)}
                          className={cn(
                            "px-1.5 py-0.5 text-[10px] font-bold transition sm:text-[11px]",
                            playbackSpeed === speed.id
                              ? "bg-[var(--bom-yellow)] text-[var(--brand)]"
                              : "bg-[var(--navy-deep)] text-[var(--brand)]/80 hover:bg-[var(--page)]/10",
                          )}
                          aria-pressed={playbackSpeed === speed.id}
                        >
                          {speed.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {mapsError && loopFrames.length === 0 ? (
                  <p className="text-xs text-[var(--brand)]">{mapsError}</p>
                ) : loopFrames.length === 0 && !mapsLoading ? (
                  <p className="text-xs text-[var(--brand)]/75">
                    {satProductMeta.daytimeOnly
                      ? "Visible imagery needs daylight over Australia — try Infrared or Air Mass."
                      : "No frames for this product right now."}
                  </p>
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
                        const next = scrubToFrameIndex(
                          Number(e.target.value),
                          loopFrames.length,
                        );
                        setFrameIndex(next);
                      }}
                      className="w-full accent-[var(--bom-yellow)] disabled:opacity-40"
                      aria-label={`${satProductMeta.label} satellite timeline`}
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-[var(--brand)]/70">
                      <span>{edgeLabels.start}</span>
                      <span className="hidden sm:inline">{edgeLabels.mid}</span>
                      <span>{edgeLabels.end}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : showRadarUi ? (
            <div className="flex items-center gap-3 border border-white/25 bg-[var(--bom-blue)] px-3 py-2.5 text-[var(--brand)]">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="inline-flex h-9 w-9 items-center justify-center bg-[var(--bom-yellow)] text-[var(--brand)]"
                aria-label={playing ? "Pause timeline" : "Play timeline"}
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 translate-x-px" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--brand)]/80">
                  <span className="font-semibold text-[var(--brand)]">{scrubLabel}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Radar loop (demo)</span>
                    <div
                      className="inline-flex items-center gap-0.5"
                      role="group"
                      aria-label="Animation speed"
                    >
                      {PLAYBACK_SPEEDS.map((speed) => (
                        <button
                          key={speed.id}
                          type="button"
                          onClick={() => setPlaybackSpeed(speed.id)}
                          className={cn(
                            "px-1.5 py-0.5 text-[10px] font-bold transition sm:text-[11px]",
                            playbackSpeed === speed.id
                              ? "bg-[var(--bom-yellow)] text-[var(--brand)]"
                              : "bg-[var(--navy-deep)] text-[var(--brand)]/80 hover:bg-[var(--page)]/10",
                          )}
                          aria-pressed={playbackSpeed === speed.id}
                        >
                          {speed.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={radarScrub}
                  onChange={(e) => {
                    setPlaying(false);
                    setRadarScrub(Number(e.target.value));
                  }}
                  className="w-full accent-[var(--bom-yellow)]"
                  aria-label="Radar timeline"
                />
                <p className="mt-1 text-[10px] text-[var(--brand)]/70">
                  Live radar tiles land in a later pass — demo cells only for now.
                </p>
              </div>
            </div>
          ) : (
            <p className="border border-white/25 bg-[var(--bom-blue-mid)] px-3 py-2 text-xs text-[var(--ink)]/80">
              Select{" "}
              <span className="font-semibold text-[var(--ink)]">Satellite</span>{" "}
              for Visible / Infrared / Air Mass loops, or{" "}
              <span className="font-semibold text-[var(--ink)]">Radar</span> for
              the demo playback strip. Overlays on the left can be mixed with Map.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Panel>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-bold text-[var(--ink)]">{SYDNEY_NOW.place}</p>
                <p className="text-xs text-[var(--ink)]/70">{SYDNEY_NOW.clockLabel}</p>
              </div>
              <CloudSun className="h-10 w-10 text-[var(--bom-yellow)]" />
            </div>
            <p className="mt-1 text-4xl font-bold text-[var(--ink)]">
              {SYDNEY_NOW.tempC}°C
            </p>
            <p className="text-sm text-[var(--ink)]/80">{SYDNEY_NOW.condition}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {[
                ["Feels like", `${SYDNEY_NOW.feelsLikeC}°C`],
                ["Humidity", `${SYDNEY_NOW.humidityPct}%`],
                ["Wind", SYDNEY_NOW.wind],
                ["Gusts", SYDNEY_NOW.gusts],
                ["Rain (today)", `${SYDNEY_NOW.rainTodayMm} mm`],
                ["Pressure", `${SYDNEY_NOW.pressureHpa} hPa`],
              ].map(([k, v]) => (
                <div key={k} className="bg-[var(--ink)]/8 px-2 py-1.5">
                  <p className="text-[var(--ink)]/70">{k}</p>
                  <p className="font-bold text-[var(--ink)]">{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-3 border-t border-[var(--ink)]/15 pt-2 text-xs text-[var(--ink)]/85">
              <span>
                Min{" "}
                <strong className="text-[var(--ink)]">{SYDNEY_NOW.minC}°</strong>
              </span>
              <span>
                Max{" "}
                <strong className="text-[var(--bom-yellow)]">
                  {SYDNEY_NOW.maxC}°
                </strong>
              </span>
              <span>
                Rain chance{" "}
                <strong className="text-[var(--ink)]">{SYDNEY_NOW.rainChancePct}%</strong>
              </span>
              <span>
                UV <strong className="text-[var(--ink)]">{SYDNEY_NOW.uv}</strong>
              </span>
            </div>
          </Panel>

          <Panel title="Severe Weather Warnings">
            <ul className="space-y-2">
              {WARNINGS.map((w) => (
                <li
                  key={w.id}
                  className="flex gap-2 bg-[var(--ink)]/8 p-2"
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
                    <p className="text-sm font-bold text-[var(--ink)]">{w.title}</p>
                    <p className="text-xs text-[var(--ink)]/75">{w.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link
              href="/severe-weather"
              className="mt-2 inline-block text-xs font-semibold text-[var(--ink)] font-semibold hover:underline"
            >
              All warnings →
            </Link>
          </Panel>

          <Panel title="Storm Tracker">
            <div className="overflow-hidden border border-[var(--ink)]/20">
              <div
                className="flex h-24 items-end justify-center bg-[linear-gradient(135deg,#001a3a,#003087)] p-2"
                aria-hidden
              >
                <div className="h-16 w-28 rounded-full bg-[radial-gradient(circle_at_40%_40%,#ef4444_0%,#eab308_35%,#22c55e_65%,transparent_70%)] opacity-90" />
              </div>
              <div className="space-y-1 bg-[var(--ink)]/10 p-2 text-xs">
                <p className="font-bold text-[var(--ink)]">Storm 1427 · eastern NSW</p>
                <p className="text-[var(--ink)]/75">Moving SE · 28 km/h</p>
                <p className="text-[var(--ink)]/75">Lightning 12/min · Hail: Large</p>
                <p className="text-[var(--ink)]/75">Max wind 95 km/h · Rain 42 mm/h</p>
              </div>
            </div>
          </Panel>

          <Panel title="Briefing notes">
            <ul className="space-y-2">
              {HIGHLIGHTS.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-[var(--ink)]/85">
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
              className="bg-[var(--ink)]/8 px-2 py-2 text-center"
            >
              <p className="text-xs font-bold text-[var(--ink)]">{c.city}</p>
              <p className="text-xl font-bold text-[var(--ink)]">
                {c.tempC}°
              </p>
              <p className="text-[10px] text-[var(--ink)]/75">{c.wind}</p>
              <p className="text-[10px] text-[var(--ink)]/70">{c.condition}</p>
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
                <span className="text-[var(--ink)]/70">{d.day}</span>
                <DayIcon kind={d.icon} />
                <span className="font-bold text-[var(--bom-yellow)]">
                  {d.high}°
                </span>
                <span className="text-[var(--ink)]/80">{d.low}°</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Model Comparison — Sydney">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[240px] text-left text-xs">
              <thead className="text-[var(--ink)]/70">
                <tr>
                  <th className="pb-2 font-semibold">Metric</th>
                  <th className="pb-2 font-semibold">ECMWF</th>
                  <th className="pb-2 font-semibold">ACCESS</th>
                  <th className="pb-2 font-semibold">GFS</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_ROWS.map((row) => (
                  <tr key={row.metric} className="border-t border-[var(--ink)]/15">
                    <td className="py-1.5 text-[var(--ink)]/75">{row.metric}</td>
                    <td className="py-1.5 font-semibold text-[var(--ink)]">
                      {row.ecmwf}
                    </td>
                    <td className="py-1.5 font-semibold text-[var(--ink)]">
                      {row.access}
                    </td>
                    <td className="py-1.5 font-semibold text-[var(--ink)]">{row.gfs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Upper air — Sydney (demo)">
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
            <div className="absolute bottom-2 left-2 flex gap-3 text-[10px] text-[var(--ink)]/80">
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
