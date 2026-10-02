"use client";

import { ChevronDown, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HomeHero } from "@/components/home/home-hero";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import { HomeWarningsPanel } from "@/components/warnings/home-warnings-panel";
import {
  HomeBriefingPanel,
  HomeCapitalsPanel,
  HomeDateHeading,
  HomeNowPanel,
  HomeSydneyForecastProvider,
  HomeWeekPanel,
} from "@/components/home/home-live-panels";
import {
  HomeModelComparisonPanel,
  HomeStormTrackerPanel,
  HomeUpperAirPanel,
} from "@/components/home/home-insight-panels";
import {
  DEFAULT_MAP_REGION,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_WEATHER_LAYERS,
  MAP_MODES,
  MAP_REGIONS,
  MAP_SETTINGS,
  WEATHER_LAYERS,
  getMapRegion,
  type LayerId,
  type MapMode,
  type MapRegionId,
  type MapSettingId,
  type MapSettingsState,
} from "@/components/home/mock-data";

export type HomeDashboardFocus = "radar" | "satellite";
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
        "relative h-5 w-9 shrink-0 rounded-full transition",
        on ? "bg-[var(--cyan)]" : "bg-white/20",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition",
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
    <section className={cn("sw-panel p-3", className)}>
      {title ? <h2 className="sw-panel-title">{title}</h2> : null}
      {children}
    </section>
  );
}

function OverlayControls({
  layers,
  mapSettings,
  regionId,
  regionLabel,
  setLayer,
  setMapSetting,
}: {
  layers: Record<LayerId, boolean>;
  mapSettings: MapSettingsState;
  regionId: MapRegionId;
  regionLabel: string;
  setLayer: (id: LayerId, on: boolean) => void;
  setMapSetting: (id: MapSettingId, on: boolean) => void;
}) {
  return (
    <>
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

      <Panel title="Map settings">
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

      <div className="rounded-2xl border border-[var(--cyan)]/25 bg-[var(--cyan)]/10 px-3 py-3 text-xs text-white/80">
        <p className="font-bold text-[var(--cyan)]">
          {regionId === "national"
            ? "Australia-wide coverage"
            : `${regionLabel} focus`}
        </p>
        <p className="mt-1">
          {regionId === "national"
            ? "From tropical coasts to alpine peaks."
            : "Map and satellite zoom into this region — pick National to return."}
        </p>
      </div>
    </>
  );
}

export function HomeDashboard({
  focus,
}: {
  focus?: HomeDashboardFocus;
} = {}) {
  const [layers, setLayers] = useState<Record<LayerId, boolean>>(() => {
    if (focus === "radar") {
      return { ...DEFAULT_WEATHER_LAYERS, radar: true, lightning: true };
    }
    return DEFAULT_WEATHER_LAYERS;
  });
  const [mapSettings, setMapSettings] =
    useState<MapSettingsState>(DEFAULT_MAP_SETTINGS);
  const [mode, setMode] = useState<MapMode>(() =>
    focus === "radar" ? "Map" : "Satellite",
  );
  const [regionId, setRegionId] = useState<MapRegionId>(DEFAULT_MAP_REGION);

  useEffect(() => {
    if (focus === "radar") {
      setMode("Map");
      setLayers((prev) => ({ ...prev, radar: true }));
    } else if (focus === "satellite") {
      setMode("Satellite");
    }
  }, [focus]);
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
  /** Hard reset key (product / region) — tip advances are soft live updates. */
  const hardLoopKeyRef = useRef("");
  const prevTipRef = useRef(0);
  const activeTimeRef = useRef<number | null>(null);
  const playbackHoldMsRef = useRef(0);

  const {
    satelliteFrames,
    radarFrames,
    loading: mapsLoading,
    error: mapsError,
    lastTipAt,
    tipSeenAtMs,
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

  useEffect(() => {
    if (activeFrame?.time != null) activeTimeRef.current = activeFrame.time;
  }, [activeFrame?.time]);

  /** Rain radar overlay frame: time-matched on Satellite, latest on Map. */
  const overlayRadarFrame = useMemo(() => {
    if (!showRadarOverlay || radarFrames.length === 0) return null;
    if (showSatelliteLoop && activeFrame) {
      return pickWeatherFrame(radarFrames, activeFrame.time, 15 * 60);
    }
    return radarFrames[radarFrames.length - 1] ?? null;
  }, [showRadarOverlay, showSatelliteLoop, activeFrame, radarFrames]);

  const {
    readyCount,
    total: preloadTotal,
    allReady,
    isIndexReady,
  } = useFramePreloader(loopFrames, showSatelliteLoop);

  const hardLoopKey = `${satProduct}:${regionId}`;
  const tipTime = loopFrames[loopFrames.length - 1]?.time ?? 0;

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

  // Soft live tip updates: keep the same wall-clock frame when a new 10-minute
  // Himawari stamp arrives. Hard-reset only when product/region changes.
  useEffect(() => {
    if (!showSatelliteLoop) return;
    if (loopFrames.length === 0) {
      setPlaying(false);
      setFrameIndex(0);
      return;
    }

    const hardChanged = hardLoopKeyRef.current !== hardLoopKey;
    const prevTip = prevTipRef.current;
    const tipAdvanced = prevTip > 0 && tipTime > prevTip;

    hardLoopKeyRef.current = hardLoopKey;
    prevTipRef.current = tipTime;

    if (hardChanged || prevTip === 0) {
      autoPlayKeyRef.current = "";
      userPausedRef.current = false;
      setPlaying(false);
      setFrameIndex(0);
      return;
    }

    if (tipAdvanced) {
      const keepTime = activeTimeRef.current;
      let nextIndex = keepTime
        ? loopFrames.findIndex((f) => f.time === keepTime)
        : -1;
      if (nextIndex < 0) {
        // Sliding window dropped the current stamp — stay near the live tip.
        nextIndex = Math.max(0, loopFrames.length - 2);
      }
      setFrameIndex(nextIndex);
      // Keep playing if the user hadn't paused.
      if (!userPausedRef.current && autoPlayKeyRef.current) {
        setPlaying(true);
      }
    } else {
      // Length/order tweaks without a newer tip — clamp index.
      setFrameIndex((prev) => Math.min(prev, loopFrames.length - 1));
    }
  }, [hardLoopKey, tipTime, loopFrames, showSatelliteLoop]);

  // Auto-start once a usable buffer is warm (or the whole loop is ready).
  useEffect(() => {
    if (!showSatelliteLoop || loopFrames.length === 0) return;
    if (userPausedRef.current) return;
    if (autoPlayKeyRef.current === hardLoopKey && playing) return;

    const minReady = Math.min(
      loopFrames.length,
      Math.max(4, Math.ceil(loopFrames.length * 0.25)),
    );
    if (!allReady && readyCount < minReady) return;

    autoPlayKeyRef.current = hardLoopKey;
    if (hardLoopKeyRef.current === hardLoopKey && frameIndex === 0) {
      // Only force start-from-zero on the initial warm for this hard key.
    }
    setPlaying(true);
  }, [
    showSatelliteLoop,
    loopFrames.length,
    hardLoopKey,
    readyCount,
    allReady,
    playing,
    frameIndex,
  ]);

  // Fixed-cadence playback. Prefer the next buffered frame; if it is still
  // loading, hold briefly then advance to the nearest ready neighbour so the
  // loop never freezes or visually jumps over missing stamps.
  useEffect(() => {
    if (!playing || !showSatelliteLoop || loopFrames.length === 0) return;
    const n = loopFrames.length;
    playbackHoldMsRef.current = 0;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => {
        const next = (prev + 1) % n;
        if (isIndexReady(next) || allReady) {
          playbackHoldMsRef.current = 0;
          return next;
        }
        playbackHoldMsRef.current += playback.msPerFrame;
        if (playbackHoldMsRef.current < playback.msPerFrame * 2) {
          return prev;
        }
        playbackHoldMsRef.current = 0;
        for (let step = 1; step < n; step++) {
          const candidate = (prev + step) % n;
          if (isIndexReady(candidate)) return candidate;
        }
        return next;
      });
    }, playback.msPerFrame);
    return () => window.clearInterval(id);
  }, [
    playing,
    showSatelliteLoop,
    loopFrames.length,
    playback.msPerFrame,
    isIndexReady,
    allReady,
  ]);

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
      if (satMenuOpen && satMenuRef.current && !satMenuRef.current.contains(t)) {
        setSatMenuOpen(false);
      }
      if (
        regionMenuOpen &&
        regionMenuRef.current &&
        !regionMenuRef.current.contains(t)
      ) {
        setRegionMenuOpen(false);
      }
    }
    // Use bubble-phase click so button onClick runs first.
    document.addEventListener("click", onPointerDown);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSatMenuOpen(false);
        setRegionMenuOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onPointerDown);
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
    return `${satProductMeta.loopLabel} · live 10 min`;
  }, [
    mapsLoading,
    mapsError,
    loopFrames.length,
    satProductMeta.daytimeOnly,
    satProductMeta.loopLabel,
    readyCount,
    preloadTotal,
  ]);

  const liveTipLabel = useMemo(() => {
    if (!lastTipAt) return null;
    return formatFrameTimeAEST(lastTipAt);
  }, [lastTipAt]);

  const liveFresh = tipSeenAtMs != null && Date.now() - tipSeenAtMs < 2 * 60_000;

  function setLayer(id: LayerId, on: boolean) {
    setLayers((prev) => ({ ...prev, [id]: on }));
  }

  function setMapSetting(id: MapSettingId, on: boolean) {
    setMapSettings((prev) => ({ ...prev, [id]: on }));
  }

  const pageTitle =
    focus === "radar"
      ? "Radar"
      : focus === "satellite"
        ? "Satellite"
        : "National overview";
  const pageSubtitle =
    focus === "radar"
      ? "Live rain radar with lightning and national map overlays."
      : focus === "satellite"
        ? "Himawari loops across Australia — infrared, visible and air mass."
        : null;

  return (
    <HomeSydneyForecastProvider>
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
      {!focus ? <HomeHero /> : null}

      <div className="animate-fade-up space-y-0.5">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
          {pageTitle}
        </h1>
        <p className="text-sm text-white/70 sm:text-base">
          {pageSubtitle ?? (
            <>
              <HomeDateHeading /> — observed and forecast across Australia.
            </>
          )}
        </p>
      </div>

      <div className="animate-fade-up-delay grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_280px] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* Desktop overlays sidebar */}
        <div className="hidden space-y-3 lg:block">
          <OverlayControls
            layers={layers}
            mapSettings={mapSettings}
            regionId={regionId}
            regionLabel={region.label}
            setLayer={setLayer}
            setMapSetting={setMapSetting}
          />
        </div>

        <div className="order-1 flex min-h-0 flex-col gap-2 lg:order-none">
          <div className="relative z-[60] flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-white/55">
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
                        "sw-chip inline-flex items-center gap-1",
                        mode === "Satellite" ? "sw-chip-active" : "sw-chip-idle",
                      )}
                    >
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
                        className="absolute left-0 top-full z-[70] mt-1 max-h-72 min-w-[13rem] overflow-y-auto rounded-xl border border-white/10 bg-[#0f172a]/95 py-1 text-white shadow-xl backdrop-blur-xl"
                      >
                        {SATELLITE_PRODUCTS.map((p) => (
                          <li key={p.id} role="option" aria-selected={satProduct === p.id}>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center px-3 py-2 text-left text-sm font-semibold transition",
                                satProduct === p.id
                                  ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                                  : "text-white/80 hover:bg-white/5 hover:text-white",
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
                    "sw-chip inline-flex items-center gap-0.5",
                    mode === m ? "sw-chip-active" : "sw-chip-idle",
                  )}
                >
                  {m}
                </button>
              );
            })}

            <div className="relative z-[70]" ref={regionMenuRef}>
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
                  "sw-chip inline-flex items-center gap-1",
                  regionId !== "national" ? "sw-chip-active" : "sw-chip-idle",
                )}
              >
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
                  className="absolute left-0 top-full z-[80] mt-1 max-h-80 min-w-[14rem] overflow-y-auto rounded-xl border border-white/10 bg-[#0f172a]/95 py-1 text-white shadow-xl backdrop-blur-xl"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {MAP_REGIONS.map((r) => (
                    <li key={r.id} role="option" aria-selected={regionId === r.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold transition",
                          regionId === r.id
                            ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                            : "text-white/80 hover:bg-white/5 hover:text-white",
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
              "relative z-0 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_12px_40px_rgba(0,0,0,0.35)]",
              // Satellite: let the region crop's mercator aspect drive height so
              // tall states (WA/QLD/NT/…) are not clipped by a fixed 4:3 box.
              showSatelliteLoop
                ? "w-full"
                : "min-h-[280px] sm:min-h-[360px] lg:min-h-[420px] lg:flex-1",
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
                  ? `${satProduct}-${regionId}-${activeFrame.time}`
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
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-2 text-white backdrop-blur-xl sm:gap-3 sm:px-3 sm:py-2.5">
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
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cyan)] text-[#041018] shadow-[0_0_20px_rgba(34,211,238,0.3)] disabled:opacity-40"
                aria-label={playing ? "Pause timeline" : "Play timeline"}
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 translate-x-px" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-white/70">
                  <span className="inline-flex flex-wrap items-center gap-2 font-semibold text-white">
                    {scrubLabel}
                    {loopFrames.length > 0 ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          liveFresh
                            ? "bg-[var(--cyan)] text-[#041018]"
                            : "bg-white/10 text-white/80",
                        )}
                        title={
                          liveTipLabel
                            ? `Latest frame ${liveTipLabel} · checks for a new 10-minute frame every minute`
                            : "Live Himawari updates"
                        }
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            liveFresh ? "bg-[#041018]" : "bg-emerald-400",
                          )}
                          aria-hidden
                        />
                        Live
                      </span>
                    ) : null}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="hidden sm:inline">{loopStatusLabel}</span>
                    {loopFrames.length > 0 ? (
                      <span className="text-[10px] text-white/55">
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
                            "rounded-full px-1.5 py-0.5 text-[10px] font-bold transition sm:text-[11px]",
                            playbackSpeed === speed.id
                              ? "bg-[var(--cyan)] text-[#041018]"
                              : "bg-white/8 text-white/75 hover:bg-white/12",
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
                  <p className="text-xs text-white/85">{mapsError}</p>
                ) : loopFrames.length === 0 && !mapsLoading ? (
                  <p className="text-xs text-white/65">
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
                      className="w-full accent-[var(--cyan)] disabled:opacity-40"
                      aria-label={`${satProductMeta.label} satellite timeline`}
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-white/55">
                      <span>{edgeLabels.start}</span>
                      <span className="hidden sm:inline">{edgeLabels.mid}</span>
                      <span>{edgeLabels.end}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/75">
              <span className="font-semibold text-white">Map</span> view with
              live overlays. Use{" "}
              <span className="font-semibold text-white">Region</span> to zoom
              into a state, or{" "}
              <span className="font-semibold text-white">Satellite</span> for
              Himawari loops. Rain radar stays available as an overlay.
            </p>
          )}

          {/* Mobile map layers accordion */}
          <details className="sw-panel group lg:hidden">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-2">
                Map layers & settings
                <ChevronDown className="h-4 w-4 opacity-70 transition group-open:rotate-180" />
              </span>
            </summary>
            <div className="space-y-3 border-t border-white/10 p-3">
              <OverlayControls
                layers={layers}
                mapSettings={mapSettings}
                regionId={regionId}
                regionLabel={region.label}
                setLayer={setLayer}
                setMapSetting={setMapSetting}
              />
            </div>
          </details>
        </div>

        <div className="order-2 space-y-3 lg:order-none">
          <HomeNowPanel />

          <HomeWarningsPanel />

          <HomeStormTrackerPanel />

          <HomeBriefingPanel />
        </div>
      </div>

      <HomeCapitalsPanel />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HomeWeekPanel />

        <HomeModelComparisonPanel />

        <HomeUpperAirPanel />
      </div>
    </div>
    </HomeSydneyForecastProvider>
  );
}
