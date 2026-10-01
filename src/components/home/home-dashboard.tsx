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
  DEFAULT_MAP_REGION,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_WEATHER_LAYERS,
  HIGHLIGHTS,
  MAP_MODES,
  MAP_REGIONS,
  MAP_SETTINGS,
  MODEL_ROWS,
  SYDNEY_NOW,
  WARNINGS,
  WEEK_FORECAST,
  WEATHER_LAYERS,
  getMapRegion,
  type LayerId,
  type MapMode,
  type MapRegionId,
  type MapSettingId,
  type MapSettingsState,
} from "@/components/home/mock-data";
import { useWeatherMaps } from "@/hooks/use-weather-maps";
import { useFramePreloader } from "@/hooks/use-frame-preloader";
import { useLightning } from "@/hooks/use-lightning";
import { useSynoptic } from "@/hooks/use-synoptic";
import { pickSynopticFrame } from "@/lib/weather/synoptic";
import { prefetchSynopticGeoJson } from "@/lib/weather/synoptic-geojson-cache";
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SATELLITE_PRODUCT,
  PLAYBACK_SPEEDS,
  SATELLITE_PRODUCTS,
  formatFrameTimeAEST,
  frameIndexToScrub,
  getPlaybackSpeed,
  getSatelliteProduct,
  pickWeatherFrame,
  satelliteFrameProxyUrl,
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
  const [layers, setLayers] =
    useState<Record<LayerId, boolean>>(DEFAULT_WEATHER_LAYERS);
  const [mapSettings, setMapSettings] =
    useState<MapSettingsState>(DEFAULT_MAP_SETTINGS);
  const [mode, setMode] = useState<MapMode>("Satellite");
  const [regionId, setRegionId] = useState<MapRegionId>(DEFAULT_MAP_REGION);
  const [satProduct, setSatProduct] = useState<SatelliteProductId>(
    DEFAULT_SATELLITE_PRODUCT,
  );
  const [satMenuOpen, setSatMenuOpen] = useState(false);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const satMenuRef = useRef<HTMLDivElement>(null);
  const regionMenuRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeedId>(
    DEFAULT_PLAYBACK_SPEED,
  );
  /** Respect manual pause; autoplay resumes only after user hits play again. */
  const userPausedRef = useRef(false);
  const autoPlayKeyRef = useRef("");

  const {
    satelliteFrames,
    radarFrames,
    loading: mapsLoading,
    error: mapsError,
    satelliteSource,
  } = useWeatherMaps(satProduct);

  const showLightning = layers.lightning;
  const { strikes: lightningStrikes } = useLightning(showLightning);

  const showSynoptic = layers.synoptic;
  const {
    frames: synopticFrames,
    geojson: synopticGeoJson,
    validTime: synopticValidTime,
  } = useSynoptic(showSynoptic);

  const showRadarOverlay = layers.radar;
  const region = getMapRegion(regionId);
  const satProductMeta = getSatelliteProduct(satProduct);
  const playback = getPlaybackSpeed(playbackSpeed);
  const showSatelliteLoop = mode === "Satellite";

  const loopFrames = useMemo(() => {
    if (!showSatelliteLoop) return [];
    return satelliteFrames.map((frame) => ({
      ...frame,
      imageUrl: satelliteFrameProxyUrl(satProduct, frame.time, {
        region: regionId,
      }),
      imageBounds: region.bounds,
    }));
  }, [showSatelliteLoop, satelliteFrames, satProduct, regionId, region.bounds]);

  const activeFrame = loopFrames[frameIndex] ?? null;
  const scrub =
    loopFrames.length > 0
      ? frameIndexToScrub(frameIndex, loopFrames.length)
      : 100;

  /** Rain radar overlay frame: time-matched on Satellite, latest on Map. */
  const overlayRadarFrame = useMemo(() => {
    if (!showRadarOverlay || radarFrames.length === 0) return null;
    if (showSatelliteLoop && activeFrame) {
      return pickWeatherFrame(radarFrames, activeFrame.time, 10 * 60);
    }
    return radarFrames[radarFrames.length - 1] ?? null;
  }, [showRadarOverlay, showSatelliteLoop, activeFrame, radarFrames]);

  const {
    readyCount,
    total: preloadTotal,
    allReady,
  } = useFramePreloader(loopFrames, showSatelliteLoop);

  const loopIdentity = useMemo(() => {
    if (loopFrames.length === 0) return "";
    return `${satProduct}:${regionId}:${loopFrames[0]?.time ?? 0}:${loopFrames[loopFrames.length - 1]?.time ?? 0}:${loopFrames.length}`;
  }, [loopFrames, satProduct, regionId]);

  // Prefetch synoptic analyses that cover the satellite loop into the shared
  // memory cache so play-from-start never waits on the network.
  useEffect(() => {
    if (!showSynoptic || !showSatelliteLoop) return;
    if (synopticFrames.length === 0 || loopFrames.length === 0) return;
    const urls = new Set<string>();
    for (const sat of loopFrames) {
      const syn = pickSynopticFrame(synopticFrames, sat.time);
      if (syn?.geojsonUrl) urls.add(syn.geojsonUrl);
    }
    // Also warm the newest catalog stamps (often includes the embedded field).
    for (const syn of synopticFrames.slice(0, 4)) {
      if (syn.geojsonUrl) urls.add(syn.geojsonUrl);
    }
    void prefetchSynopticGeoJson(urls);
  }, [showSynoptic, showSatelliteLoop, loopFrames, synopticFrames]);

  // Reset to start when the loop catalog identity changes (product / region / frames).
  useEffect(() => {
    if (!showSatelliteLoop) return;
    if (loopFrames.length === 0) {
      setFrameIndex(0);
      return;
    }
    setFrameIndex(0);
    autoPlayKeyRef.current = "";
    userPausedRef.current = false;
  }, [loopIdentity, showSatelliteLoop, loopFrames.length]);

  // Auto-start once a usable buffer is warm (or the whole loop is ready).
  useEffect(() => {
    if (!showSatelliteLoop || loopFrames.length === 0) return;
    if (userPausedRef.current) return;
    if (autoPlayKeyRef.current === loopIdentity && playing) return;

    const minReady = Math.min(loopFrames.length, Math.max(4, Math.ceil(loopFrames.length * 0.25)));
    if (!allReady && readyCount < minReady) return;

    autoPlayKeyRef.current = loopIdentity;
    setFrameIndex(0);
    setPlaying(true);
  }, [
    showSatelliteLoop,
    loopFrames.length,
    loopIdentity,
    readyCount,
    allReady,
    playing,
  ]);

  // Fixed-cadence satellite playback — never stall waiting on a frame.
  useEffect(() => {
    if (!playing || !showSatelliteLoop || loopFrames.length === 0) return;
    const n = loopFrames.length;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % n);
    }, playback.msPerFrame);
    return () => window.clearInterval(id);
  }, [playing, showSatelliteLoop, loopFrames.length, playback.msPerFrame]);

  useEffect(() => {
    if (!showSatelliteLoop) {
      setPlaying(false);
      userPausedRef.current = false;
    }
  }, [showSatelliteLoop]);

  useEffect(() => {
    if (!satMenuOpen && !regionMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (satMenuRef.current && !satMenuRef.current.contains(t)) {
        setSatMenuOpen(false);
      }
      if (regionMenuRef.current && !regionMenuRef.current.contains(t)) {
        setRegionMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSatMenuOpen(false);
        setRegionMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [satMenuOpen, regionMenuOpen]);

  const scrubLabel = useMemo(() => {
    if (!showSatelliteLoop) return "";
    if (mapsLoading && loopFrames.length === 0) return "Loading…";
    if (mapsError && loopFrames.length === 0) return "Unavailable";
    if (!activeFrame) {
      if (satProductMeta.daytimeOnly) return "No daytime frames";
      return "No frames";
    }
    return formatFrameTimeAEST(activeFrame.time);
  }, [
    showSatelliteLoop,
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
      return `Buffering ${readyCount}/${preloadTotal}`;
    }
    return satProductMeta.loopLabel;
  }, [
    mapsLoading,
    mapsError,
    loopFrames.length,
    satProductMeta.daytimeOnly,
    satProductMeta.loopLabel,
    readyCount,
    preloadTotal,
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

      <div className="animate-fade-up-delay grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_260px] xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <Panel title="Map overlays">
            <p className="mb-2 text-[11px] text-[var(--ink)]/70">
              Live layers on Map and Satellite — rain radar and lightning sync to
              the loop timeline when available.
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
            <p className="font-bold text-[var(--brand)]">
              {regionId === "national"
                ? "Australia-wide coverage"
                : `${region.label} focus`}
            </p>
            <p className="mt-1">
              {regionId === "national"
                ? "From tropical coasts to alpine peaks."
                : "Map and satellite zoom into this region — pick National to return."}
            </p>
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
                        setRegionMenuOpen(false);
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
                    setRegionMenuOpen(false);
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

            <div className="relative z-40" ref={regionMenuRef}>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={regionMenuOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSatMenuOpen(false);
                  setRegionMenuOpen((open) => !open);
                }}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition sm:text-sm",
                  regionId !== "national"
                    ? "bg-[var(--bom-yellow)] text-[var(--brand)]"
                    : "bg-[var(--bom-blue)] text-[var(--brand)] hover:bg-[var(--navy-deep)]",
                )}
              >
                <ChevronRight className="h-3.5 w-3.5 opacity-80" aria-hidden />
                Region
                <span className="font-normal opacity-80">
                  · {region.short}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 opacity-80 transition",
                    regionMenuOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {regionMenuOpen ? (
                <ul
                  role="listbox"
                  aria-label="Map region"
                  className="absolute left-0 top-full z-50 mt-1 max-h-80 min-w-[14rem] overflow-y-auto border border-[var(--brand)]/15 bg-[var(--bom-blue)] py-1 text-[var(--brand)] shadow-lg"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {MAP_REGIONS.map((r) => (
                    <li key={r.id} role="option" aria-selected={regionId === r.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold transition",
                          regionId === r.id
                            ? "bg-[var(--bom-yellow)]"
                            : "hover:bg-[var(--navy-deep)]",
                        )}
                        onClick={() => {
                          setRegionId(r.id);
                          setRegionMenuOpen(false);
                        }}
                      >
                        <span>{r.label}</span>
                        <span className="text-[10px] font-bold opacity-70">
                          {r.short}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
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
              regionId={regionId}
              showRadarOverlay={showRadarOverlay}
              frameTileUrl={
                showRadarOverlay
                  ? (overlayRadarFrame?.tileUrlTemplate ?? null)
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
                  ? `${satProduct}-${regionId}-${activeFrame.time}-${satelliteSource ?? "wx"}`
                  : showRadarOverlay && overlayRadarFrame
                    ? `radar-overlay-${overlayRadarFrame.time}`
                    : undefined
              }
              frameOpacity={1}
              frameAlt={
                showSatelliteLoop
                  ? `${satProductMeta.label} · ${region.label}`
                  : "Map frame"
              }
              mapSettings={mapSettings}
              showLightning={showLightning}
              lightningStrikes={lightningStrikes}
              lightningReferenceTime={
                showSatelliteLoop ? (activeFrame?.time ?? null) : null
              }
              lightningTimelineStart={
                showSatelliteLoop && loopFrames.length > 0
                  ? (loopFrames[0]?.time ?? null)
                  : null
              }
              lightningTimelineEnd={
                showSatelliteLoop && loopFrames.length > 0
                  ? (loopFrames[loopFrames.length - 1]?.time ?? null)
                  : null
              }
              lightningPlaying={showSatelliteLoop && playing}
              lightningMsPerFrame={playback.msPerFrame}
              lightningNextFrameTime={
                showSatelliteLoop && loopFrames.length > 1
                  ? (loopFrames[(frameIndex + 1) % loopFrames.length]?.time ??
                    null)
                  : null
              }
              showSynoptic={showSynoptic}
              synopticFrames={synopticFrames}
              synopticGeoJson={synopticGeoJson}
              synopticValidTime={synopticValidTime}
              synopticReferenceTime={
                showSatelliteLoop ? (activeFrame?.time ?? null) : null
              }
            />
          </div>

          {showSatelliteLoop ? (
            <div className="flex items-center gap-3 border border-white/25 bg-[var(--bom-blue)] px-3 py-2.5 text-[var(--brand)]">
              <button
                type="button"
                onClick={() => {
                  if (playing) {
                    userPausedRef.current = true;
                    setPlaying(false);
                    return;
                  }
                  if (loopFrames.length === 0) return;
                  userPausedRef.current = false;
                  const restart = frameIndex >= loopFrames.length - 1;
                  if (restart) setFrameIndex(0);
                  setPlaying(true);
                }}
                disabled={
                  loopFrames.length === 0 ||
                  (readyCount === 0 && preloadTotal > 0)
                }
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
                        userPausedRef.current = true;
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
          ) : (
            <p className="border border-white/25 bg-[var(--bom-blue-mid)] px-3 py-2 text-xs text-[var(--ink)]/80">
              <span className="font-semibold text-[var(--ink)]">Map</span> view
              with live overlays. Use{" "}
              <span className="font-semibold text-[var(--ink)]">Region</span> to
              zoom into a state, or{" "}
              <span className="font-semibold text-[var(--ink)]">Satellite</span>{" "}
              for Himawari loops. Rain radar stays available as an overlay.
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
              href="/risk"
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
