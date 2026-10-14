"use client";

import { ChevronDown, Link2, Pause, Play } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { replaceUrlIfOnPath } from "@/lib/nav/safe-history";
import { CellDetailsPanel } from "@/components/home/cell-details-panel";
import { ChaseHud } from "@/components/home/chase-hud";
import { HomeCommunityPanel } from "@/components/home/home-community-panel";
import { HomeHero } from "@/components/home/home-hero";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import { HomeWarningsPanel } from "@/components/warnings/home-warnings-panel";
import { useStormCells } from "@/hooks/use-storm-cells";
import {
  HomeBriefingPanel,
  HomeCapitalsPanel,
  HomeDateHeading,
  HomeNowPanel,
  HomeSydneyForecastProvider,
  HomeWeekPanel,
  usePreferSavedRegion,
} from "@/components/home/home-live-panels";
import {
  HomeMomentCard,
  HomeModelComparisonPanel,
  HomeStormTrackerPanel,
  HomeUpperAirPanel,
} from "@/components/home/home-insight-panels";
import {
  clampLightningIconScale,
  DEFAULT_MAP_REGION,
  LIGHTNING_ICON_SCALE_MAX,
  LIGHTNING_ICON_SCALE_MIN,
  LIGHTNING_ICON_SCALE_STEP,
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
import { useWeatherMaps } from "@/hooks/use-weather-maps";
import { useFramePreloader } from "@/hooks/use-frame-preloader";
import { useLightning } from "@/hooks/use-lightning";
import { useStations } from "@/hooks/use-stations";
import { useSynoptic } from "@/hooks/use-synoptic";
import { pickSynopticFrame } from "@/lib/weather/synoptic";
import { prefetchSynopticGeoJson } from "@/lib/weather/synoptic-geojson-cache";
import {
  readMapUiPrefs,
  writeMapUiPrefs,
  type MapPageId,
} from "@/lib/prefs/map-ui";
import {
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
  withRadarSmooth,
  type PlaybackSpeedId,
  type SatelliteProductId,
} from "@/lib/weather/maps";
import { cn } from "@/lib/utils";

export type HomeDashboardFocus = "radar" | "satellite";

const MAP_MODE_LABELS: Record<MapMode, string> = {
  Zoomable: "Zoomable",
  Static: "Static",
};

function mapPageId(focus?: HomeDashboardFocus): MapPageId {
  if (focus === "radar") return "radar";
  if (focus === "satellite") return "satellite";
  return "home";
}

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
  setLightningIconScale,
}: {
  layers: Record<LayerId, boolean>;
  mapSettings: MapSettingsState;
  regionId: MapRegionId;
  regionLabel: string;
  setLayer: (id: LayerId, on: boolean) => void;
  setMapSetting: (id: MapSettingId, on: boolean) => void;
  setLightningIconScale: (scale: number) => void;
}) {
  const iconScale = clampLightningIconScale(mapSettings.lightningIconScale);
  return (
    <>
      <Panel title="Map overlays">
        <p className="mb-2 text-[11px] text-[var(--ink)]/70">
          Live layers on Map and Satellite — rain radar, lightning, and cell
          tracks sync to the loop when available. Cell tracking never zooms the
          map for you.
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
          Basemap, radar smoothing, lightning style, and cartography for the
          national map.
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
          <li className="space-y-1.5 text-sm text-[var(--ink)]/80">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="lightning-icon-scale"
                className="font-semibold text-[var(--ink)]"
              >
                Lightning icon size
              </label>
              <span className="tabular-nums text-xs text-[var(--ink)]/65">
                {Math.round(iconScale * 100)}%
              </span>
            </div>
            <input
              id="lightning-icon-scale"
              type="range"
              min={LIGHTNING_ICON_SCALE_MIN}
              max={LIGHTNING_ICON_SCALE_MAX}
              step={LIGHTNING_ICON_SCALE_STEP}
              value={iconScale}
              onChange={(e) =>
                setLightningIconScale(Number(e.target.value))
              }
              className="w-full accent-[var(--cyan)]"
              aria-label="Lightning crosshair or bolt icon size"
            />
            <div className="flex justify-between text-[10px] font-semibold text-[var(--ink)]/45">
              <span>Small</span>
              <span>Default</span>
              <span>Large</span>
            </div>
          </li>
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

function parseBoolParam(v: string | null): boolean | null {
  if (v == null) return null;
  if (v === "1" || v === "true" || v === "on") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  return null;
}

function isMapRegionId(v: string): v is MapRegionId {
  return MAP_REGIONS.some((r) => r.id === v);
}

function isMapMode(v: string): v is MapMode {
  return (MAP_MODES as readonly string[]).includes(v);
}

export function HomeDashboard({
  focus,
}: {
  focus?: HomeDashboardFocus;
} = {}) {
  const page = mapPageId(focus);
  return (
    <Suspense fallback={<div className="px-4 py-6 text-sm text-white/60">Loading map…</div>}>
      {/* Remount per page so each map slot gets a fresh prefs bind. */}
      <HomeDashboardInner key={page} focus={focus} />
    </Suspense>
  );
}

function HomeDashboardInner({
  focus,
}: {
  focus?: HomeDashboardFocus;
} = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = mapPageId(focus);
  /** False until URL params have been applied — sync must wait for this render. */
  const [urlReady, setUrlReady] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const savedUi = useMemo(() => readMapUiPrefs(page), [page]);

  const [layers, setLayers] = useState<Record<LayerId, boolean>>(
    () => savedUi.layers,
  );
  const [mapSettings, setMapSettings] = useState<MapSettingsState>(
    () => savedUi.mapSettings,
  );
  const [mode, setMode] = useState<MapMode>(() => {
    if (page === "radar") return "Zoomable";
    if (page === "satellite") return "Static";
    return savedUi.mode;
  });
  const [regionId, setRegionId] = useState<MapRegionId>(() => savedUi.regionId);
  const [satProduct, setSatProduct] = useState<SatelliteProductId>(
    () => savedUi.satProduct,
  );
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeedId>(
    () => savedUi.playbackSpeed,
  );
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const showCells = layers.cells;
  const { data: stormCellsData, loading: stormCellsLoading } =
    useStormCells(90_000, showCells);
  const stormCells = stormCellsData?.cells ?? [];

  // Rehydrate this page's localStorage slot (SSR can't), then URL overrides.
  // Sync must not run in the same effect flush with stale regionId — that was
  // stripping ?region= and yanking the map back to national framing.
  useEffect(() => {
    if (urlReady) return;
    const saved = readMapUiPrefs(page);
    setLayers(saved.layers);
    setMapSettings(saved.mapSettings);
    setPlaybackSpeed(saved.playbackSpeed);
    setSatProduct(saved.satProduct);
    setRegionId(saved.regionId);
    if (page === "radar") setMode("Zoomable");
    else if (page === "satellite") setMode("Static");
    else setMode(saved.mode);

    const region = searchParams.get("region");
    if (region && isMapRegionId(region)) setRegionId(region);
    const modeParam = searchParams.get("mode");
    if (modeParam && page === "home") {
      const normalized =
        modeParam.toLowerCase() === "map" || modeParam.toLowerCase() === "zoomable"
          ? "Zoomable"
          : modeParam.toLowerCase() === "satellite" || modeParam.toLowerCase() === "static"
            ? "Static"
            : modeParam;
      if (isMapMode(normalized)) setMode(normalized);
    }
    const radar = parseBoolParam(searchParams.get("radar"));
    const lightning = parseBoolParam(searchParams.get("lightning"));
    const synoptic = parseBoolParam(searchParams.get("synoptic"));
    const stations = parseBoolParam(searchParams.get("stations"));
    const cells = parseBoolParam(searchParams.get("cells"));
    if (
      radar != null ||
      lightning != null ||
      synoptic != null ||
      stations != null ||
      cells != null
    ) {
      setLayers((prev) => ({
        ...prev,
        ...(radar != null ? { radar } : {}),
        ...(lightning != null ? { lightning } : {}),
        ...(synoptic != null ? { synoptic } : {}),
        ...(stations != null ? { stations } : {}),
        ...(cells != null ? { cells } : {}),
      }));
    }
    const product = searchParams.get("product");
    if (
      product &&
      SATELLITE_PRODUCTS.some((p) => p.id === product)
    ) {
      setSatProduct(product as SatelliteProductId);
    }
    // Legacy chase=1 → cell tracking overlay (no auto-zoom).
    if (searchParams.get("chase") === "1") {
      setLayers((prev) => ({
        ...prev,
        cells: true,
        radar: true,
        lightning: true,
      }));
    }
    const cell = searchParams.get("cell");
    if (cell) {
      setSelectedCellId(cell);
      setLayers((prev) => ({ ...prev, cells: true }));
    }
    setUrlReady(true);
  }, [searchParams, urlReady, page]);

  // Prefer saved place region when URL did not specify one (Home only).
  usePreferSavedRegion(
    setRegionId,
    urlReady && !searchParams.get("region") && page === "home",
  );

  useEffect(() => {
    if (page === "radar") {
      setMode("Zoomable");
      setLayers((prev) => (prev.radar ? prev : { ...prev, radar: true }));
    } else if (page === "satellite") {
      setMode("Static");
    }
  }, [page]);

  // Persist this page's overlays / cartography / view prefs only.
  useEffect(() => {
    if (!urlReady) return;
    writeMapUiPrefs(page, {
      layers,
      mapSettings,
      mode,
      regionId,
      satProduct,
      playbackSpeed,
      chaseEnabled: layers.cells,
    });
  }, [
    urlReady,
    page,
    layers,
    mapSettings,
    mode,
    regionId,
    satProduct,
    playbackSpeed,
  ]);

  // Sync shareable map query params on the current dashboard route only.
  // Never rewrite the path — that fought Next.js <Link> navigations and left
  // users stuck on Home/Radar/Satellite when clicking Warnings, Forecast, etc.
  useEffect(() => {
    if (!urlReady) return;
    const path =
      focus === "radar" ? "/radar" : focus === "satellite" ? "/satellite" : "/";
    if (pathname !== path) return;

    const params = new URLSearchParams();
    if (regionId !== DEFAULT_MAP_REGION) params.set("region", regionId);
    const defaultMode: MapMode =
      focus === "radar" ? "Zoomable" : "Static";
    if (mode !== defaultMode) params.set("mode", mode.toLowerCase());
    if (layers.radar !== (focus === "radar")) {
      params.set("radar", layers.radar ? "1" : "0");
    }
    if (!layers.lightning) params.set("lightning", "0");
    if (layers.synoptic) params.set("synoptic", "1");
    if (layers.stations) params.set("stations", "1");
    if (layers.cells) params.set("cells", "1");
    // Always publish product on Satellite so region deep-links stay stable and
    // we never re-hydrate into a different product after a replace.
    if (mode === "Static" || satProduct !== DEFAULT_SATELLITE_PRODUCT) {
      params.set("product", satProduct);
    }
    if (selectedCellId) params.set("cell", selectedCellId);
    const qs = params.toString();
    const next = qs ? `${path}?${qs}` : path;
    // Query-only replace; aborts if the user already left this route.
    replaceUrlIfOnPath(path, next);
  }, [
    urlReady,
    pathname,
    regionId,
    mode,
    layers,
    satProduct,
    focus,
    selectedCellId,
  ]);

  async function copyShareLink() {
    const { shareContent } = await import("@/lib/share");
    const result = await shareContent({
      title: "Thunderstate",
      text: "Live weather across Australia — radar, lightning and satellite.",
      url: window.location.href,
    });
    if (result === "shared" || result === "copied") {
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  const [mapTypeMenuOpen, setMapTypeMenuOpen] = useState(false);
  const [satMenuOpen, setSatMenuOpen] = useState(false);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const mapTypeMenuRef = useRef<HTMLDivElement>(null);
  const satMenuRef = useRef<HTMLDivElement>(null);
  const regionMenuRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
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
    radarFrames: radarFramesRaw,
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

  const showStations = layers.stations;
  const { stations: weatherStations } = useStations(showStations);

  const showRadarOverlay = layers.radar;
  const radarSmoothing = mapSettings.radarSmoothing;
  /** Keep tile URLs on crisp RainViewer; smoothing is CSS-only on the map. */
  const radarFrames = useMemo(() => {
    const raw = radarFramesRaw;
    if (!raw.length) return raw;
    return raw.map((frame) => ({
      ...frame,
      tileUrlTemplate:
        withRadarSmooth(frame.tileUrlTemplate, radarSmoothing) ??
        frame.tileUrlTemplate,
    }));
  }, [radarFramesRaw, radarSmoothing]);
  const region = getMapRegion(regionId);
  const satProductMeta = getSatelliteProduct(satProduct);
  const playback = getPlaybackSpeed(playbackSpeed);
  /** Fixed-crop Himawari loop (Satellite view) - shows when product is not 'none'. */
  const showSatelliteLoop = mode === "Static" && satProduct !== "none";
  /** Himawari IR on the pannable Map when Satellite imagery is enabled. */
  const himawariOnMap = mode === "Zoomable" && satProduct !== "none";
  /** Satellite drives the timeline (Satellite view, or Map + satellite imagery). */
  const useSatelliteFrames = showSatelliteLoop || himawariOnMap;
  /**
   * Radar drives the timeline on open Map when rain radar is on and satellite
   * is not driving the loop. Radar can now display alongside satellite.
   */
  const useRadarLoop =
    showRadarOverlay && mode === "Zoomable" && !useSatelliteFrames;
  const useTimeline = useSatelliteFrames || useRadarLoop;

  const loopFrames = useMemo(() => {
    if (useSatelliteFrames) {
      return satelliteFrames.map((frame) => ({
        ...frame,
        imageUrl: satelliteFrameProxyUrl(satProduct, frame.time, {
          region: regionId,
        }),
        imageBounds: region.bounds,
      }));
    }
    if (useRadarLoop) return radarFrames;
    return [];
  }, [
    useSatelliteFrames,
    useRadarLoop,
    satelliteFrames,
    radarFrames,
    satProduct,
    regionId,
    region.bounds,
  ]);

  const activeFrame = loopFrames[frameIndex] ?? null;
  const scrub =
    loopFrames.length > 0
      ? frameIndexToScrub(frameIndex, loopFrames.length)
      : 100;

  useEffect(() => {
    if (activeFrame?.time != null) activeTimeRef.current = activeFrame.time;
  }, [activeFrame?.time]);

  /**
   * Rain radar tile: time-matched to the satellite timeline when that drives
   * the loop; otherwise the active radar-loop frame (or latest).
   * In Static mode with satellite, always provide radar frame for overlay.
   */
  const overlayRadarFrame = useMemo(() => {
    if (!showRadarOverlay || radarFrames.length === 0) return null;
    if (useSatelliteFrames && activeFrame) {
      return pickWeatherFrame(radarFrames, activeFrame.time, 15 * 60);
    }
    if (useRadarLoop) {
      return activeFrame ?? radarFrames[radarFrames.length - 1] ?? null;
    }
    return radarFrames[radarFrames.length - 1] ?? null;
  }, [
    showRadarOverlay,
    useSatelliteFrames,
    useRadarLoop,
    activeFrame,
    radarFrames,
  ]);

  const {
    readyCount: satReadyCount,
    total: satPreloadTotal,
    allReady: satAllReady,
    allSettled: satAllSettled,
    isIndexReady: satIsIndexReady,
    isIndexSettled: satIsIndexSettled,
  } = useFramePreloader(loopFrames, useSatelliteFrames);

  // Radar tiles stream via Leaflet — treat the catalog as ready immediately.
  const readyCount = useSatelliteFrames
    ? satReadyCount
    : useRadarLoop
      ? loopFrames.length
      : 0;
  const preloadTotal = useSatelliteFrames
    ? satPreloadTotal
    : useRadarLoop
      ? loopFrames.length
      : 0;
  const allReady = useSatelliteFrames
    ? satAllReady
    : useRadarLoop && loopFrames.length > 0;
  const allSettled = useSatelliteFrames
    ? satAllSettled
    : useRadarLoop && loopFrames.length > 0;
  const isIndexReady = useSatelliteFrames
    ? satIsIndexReady
    : () => true;
  const isIndexSettled = useSatelliteFrames
    ? satIsIndexSettled
    : () => true;

  const loopLenRef = useRef(0);
  const isIndexReadyRef = useRef(isIndexReady);
  const isIndexSettledRef = useRef(isIndexSettled);
  const allReadyRef = useRef(allReady);
  const allSettledRef = useRef(allSettled);
  loopLenRef.current = loopFrames.length;
  isIndexReadyRef.current = isIndexReady;
  isIndexSettledRef.current = isIndexSettled;
  allReadyRef.current = allReady;
  allSettledRef.current = allSettled;

  const hardLoopKey = useSatelliteFrames
    ? `sat:${satProduct}:${regionId}`
    : useRadarLoop
      ? `radar:${regionId}`
      : "none";
  const tipTime = loopFrames[loopFrames.length - 1]?.time ?? 0;

  // Prefetch a small synoptic window around the playhead (not every sat frame).
  useEffect(() => {
    if (!showSynoptic || !useTimeline) return;
    if (synopticFrames.length === 0 || loopFrames.length === 0) return;
    const urls = new Set<string>();
    const idxs = [
      frameIndex,
      Math.min(loopFrames.length - 1, frameIndex + 1),
      Math.max(0, frameIndex - 1),
      loopFrames.length - 1,
    ];
    for (const i of idxs) {
      const sat = loopFrames[i];
      if (!sat) continue;
      const syn = pickSynopticFrame(synopticFrames, sat.time);
      if (syn?.geojsonUrl) urls.add(syn.geojsonUrl);
    }
    for (const syn of synopticFrames.slice(0, 2)) {
      if (syn.geojsonUrl) urls.add(syn.geojsonUrl);
    }
    void prefetchSynopticGeoJson(urls);
  }, [showSynoptic, useTimeline, loopFrames, synopticFrames, frameIndex]);

  // Soft live tip updates: keep the same wall-clock frame when a new tip
  // arrives. Hard-reset only when product/region (or radar loop) changes.
  // Depend on tipTime + length — NOT the frames array identity — so maps
  // polls don't keep resetting playback / clearing autoplay.
  const loopLen = loopFrames.length;
  useEffect(() => {
    if (!useTimeline) return;
    if (loopLen === 0) {
      setPlaying(false);
      setFrameIndex(0);
      return;
    }

    const hardChanged = hardLoopKeyRef.current !== hardLoopKey;
    const prevTip = prevTipRef.current;
    const tipAdvanced = prevTip > 0 && tipTime > prevTip;

    hardLoopKeyRef.current = hardLoopKey;
    prevTipRef.current = tipTime;

    if (hardChanged) {
      autoPlayKeyRef.current = "";
      userPausedRef.current = false;
      setPlaying(false);
      setFrameIndex(0);
      return;
    }

    // First tip for this loop — park on frame 0; autoplay effect will start.
    if (prevTip === 0) {
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
        nextIndex = Math.max(0, loopLen - 2);
      }
      setFrameIndex(nextIndex);
      // Keep playing if the user hadn't paused.
      if (!userPausedRef.current && autoPlayKeyRef.current) {
        setPlaying(true);
      }
    } else {
      // Length/order tweaks without a newer tip — clamp index.
      setFrameIndex((prev) => Math.min(prev, loopLen - 1));
    }
    // loopFrames only read inside tipAdvanced path; tipTime/loopLen gate reruns.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [hardLoopKey, tipTime, loopLen, useTimeline]);

  // Auto-start once a usable buffer is warm (or the whole loop is ready).
  useEffect(() => {
    if (!useTimeline || loopFrames.length === 0) return;
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
    useTimeline,
    loopFrames.length,
    hardLoopKey,
    readyCount,
    allReady,
    playing,
    frameIndex,
  ]);

  // Fixed-cadence playback. Readiness is read from refs so preload settle
  // updates do not restart the interval (that was freezing the loop mid-way).
  // Never wrap to frame 0 while skipping unready mid-loop frames — that made
  // the animation look like it kept restarting during the buffer warm-up.
  useEffect(() => {
    if (!playing || !useTimeline) return;
    if (loopLenRef.current === 0) return;
    playbackHoldMsRef.current = 0;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => {
        const n = loopLenRef.current;
        if (n <= 0) return 0;

        /** Next ready index strictly ahead of `from` (no wrap). */
        const pickReadyForward = (from: number): number | null => {
          for (let candidate = from + 1; candidate < n; candidate++) {
            if (isIndexReadyRef.current(candidate)) return candidate;
          }
          return null;
        };

        const atEnd = prev >= n - 1;
        const next = atEnd ? 0 : prev + 1;

        if (isIndexReadyRef.current(next) || allReadyRef.current) {
          playbackHoldMsRef.current = 0;
          return next;
        }

        // Next stamp failed (404 / decode) — skip forward only.
        if (isIndexSettledRef.current(next)) {
          playbackHoldMsRef.current = 0;
          if (atEnd) {
            // Natural loop restart: first ready frame from the start.
            for (let candidate = 0; candidate < n; candidate++) {
              if (isIndexReadyRef.current(candidate)) return candidate;
            }
            return 0;
          }
          return pickReadyForward(prev) ?? prev;
        }

        // Still loading — hold on the current frame. After a short stall,
        // skip forward (never backwards) so a stuck stitch can't freeze play.
        playbackHoldMsRef.current += playback.msPerFrame;
        const stallBudget = playback.msPerFrame * 3;
        if (playbackHoldMsRef.current < stallBudget) {
          return prev;
        }
        playbackHoldMsRef.current = 0;
        if (atEnd) {
          return isIndexReadyRef.current(0) || allSettledRef.current ? 0 : prev;
        }
        return pickReadyForward(prev) ?? prev;
      });
    }, playback.msPerFrame);
    return () => window.clearInterval(id);
  }, [playing, useTimeline, playback.msPerFrame]);

  useEffect(() => {
    if (!useTimeline) {
      setPlaying(false);
      userPausedRef.current = false;
    }
  }, [useTimeline]);

  // Radar tile warmup lives only in SmoothRadarLayer's viewport preloader —
  // a second dashboard-wide storm of tile requests burned Fluid Active CPU.

  useEffect(() => {
    if (!mapTypeMenuOpen && !satMenuOpen && !regionMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (
        mapTypeMenuOpen &&
        mapTypeMenuRef.current &&
        !mapTypeMenuRef.current.contains(t)
      ) {
        setMapTypeMenuOpen(false);
      }
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
        setMapTypeMenuOpen(false);
        setSatMenuOpen(false);
        setRegionMenuOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [mapTypeMenuOpen, satMenuOpen, regionMenuOpen]);

  const scrubLabel = useMemo(() => {
    if (!useTimeline) return "";
    if (mapsLoading && loopFrames.length === 0) return "Loading…";
    if (mapsError && loopFrames.length === 0) return "Unavailable";
    if (!activeFrame) {
      if (useSatelliteFrames && satProductMeta.daytimeOnly) {
        return "No daytime frames";
      }
      return "No frames";
    }
    return formatFrameTimeAEST(activeFrame.time);
  }, [
    useTimeline,
    useSatelliteFrames,
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
    if (useRadarLoop) {
      if (mapsLoading && loopFrames.length === 0) return "Loading radar frames…";
      if (loopFrames.length === 0) {
        return mapsError ? "Radar loop unavailable" : "No radar frames available";
      }
      return "Rain radar · live ~10 min";
    }
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
    useRadarLoop,
    mapsLoading,
    mapsError,
    loopFrames.length,
    satProductMeta.daytimeOnly,
    satProductMeta.loopLabel,
    readyCount,
    preloadTotal,
  ]);

  const liveTipLabel = useMemo(() => {
    if (useRadarLoop) {
      const tip = loopFrames[loopFrames.length - 1]?.time;
      return tip != null ? formatFrameTimeAEST(tip) : null;
    }
    if (!lastTipAt) return null;
    return formatFrameTimeAEST(lastTipAt);
  }, [useRadarLoop, loopFrames, lastTipAt]);

  const liveFresh = useRadarLoop
    ? tipTime > 0 && Date.now() / 1000 - tipTime < 15 * 60
    : tipSeenAtMs != null && Date.now() - tipSeenAtMs < 2 * 60_000;

  function setLayer(id: LayerId, on: boolean) {
    setLayers((prev) => ({ ...prev, [id]: on }));
    if (id === "cells" && !on) {
      setSelectedCellId(null);
    }
  }

  function setMapSetting(id: MapSettingId, on: boolean) {
    setMapSettings((prev) => ({ ...prev, [id]: on }));
  }

  function setLightningIconScale(scale: number) {
    setMapSettings((prev) => ({
      ...prev,
      lightningIconScale: clampLightningIconScale(scale),
    }));
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
        ? "Satellite images across Australia — infrared, natural colour and air-mass views."
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

      <div className="animate-fade-up-delay grid items-start gap-2 lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:gap-2 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* Desktop overlays sidebar */}
        <div className="hidden space-y-3 lg:block">
          <OverlayControls
            layers={layers}
            mapSettings={mapSettings}
            regionId={regionId}
            regionLabel={region.label}
            setLayer={setLayer}
            setMapSetting={setMapSetting}
            setLightningIconScale={setLightningIconScale}
          />
        </div>

        <div className="order-1 flex min-h-0 flex-col gap-2 lg:order-none">
          <div className="relative z-[60] flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-white/55">
              View
            </span>
            <div className="relative z-[70]" ref={mapTypeMenuRef}>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={mapTypeMenuOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSatMenuOpen(false);
                  setRegionMenuOpen(false);
                  setMapTypeMenuOpen((open) => !open);
                }}
                className={cn(
                  "sw-chip inline-flex items-center gap-1",
                  mapTypeMenuOpen ? "sw-chip-active" : "sw-chip-idle",
                )}
              >
                Map type
                <span className="font-normal opacity-80">· {MAP_MODE_LABELS[mode]}</span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 opacity-80 transition",
                    mapTypeMenuOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {mapTypeMenuOpen ? (
                <ul
                  role="listbox"
                  aria-label="Map type"
                  className="absolute left-0 top-full z-[80] mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-white/10 bg-[#0f172a]/95 py-1 text-white shadow-xl backdrop-blur-xl"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {MAP_MODES.map((mapType) => (
                    <li key={mapType} role="option" aria-selected={mode === mapType}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center px-3 py-2 text-left text-sm font-semibold transition",
                          mode === mapType
                            ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                            : "text-white/80 hover:bg-white/5 hover:text-white",
                        )}
                        onClick={() => {
                          setMode(mapType);
                          setMapTypeMenuOpen(false);
                          setSatMenuOpen(false);
                        }}
                      >
                        {MAP_MODE_LABELS[mapType]}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {mode === "Static" ? (
              <div className="relative z-[70]" ref={satMenuRef}>
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={satMenuOpen}
                  aria-label={`Satellite imagery: ${satProductMeta.label}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMapTypeMenuOpen(false);
                    setRegionMenuOpen(false);
                    setSatMenuOpen((open) => !open);
                  }}
                  className={cn(
                    "sw-chip inline-flex items-center gap-1",
                    satMenuOpen ? "sw-chip-active" : "sw-chip-idle",
                  )}
                >
                  Satellite imagery
                  <span className="font-normal opacity-80">
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
                    className="absolute left-0 top-full z-[80] mt-1 max-h-72 min-w-[13rem] overflow-y-auto rounded-xl border border-white/10 bg-[#0f172a]/95 py-1 text-white shadow-xl backdrop-blur-xl"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {SATELLITE_PRODUCTS.map((product) => (
                      <li
                        key={product.id}
                        role="option"
                        aria-selected={satProduct === product.id}
                      >
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center px-3 py-2 text-left text-sm font-semibold transition",
                            satProduct === product.id
                              ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                              : "text-white/80 hover:bg-white/5 hover:text-white",
                          )}
                          onClick={() => {
                            setSatProduct(product.id);
                            setSatMenuOpen(false);
                          }}
                        >
                          {product.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

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

            <button
              type="button"
              onClick={() => void copyShareLink()}
              className="sw-chip sw-chip-idle inline-flex items-center gap-1"
              title="Copy shareable map link"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {linkCopied ? "Copied" : "Copy link"}
            </button>
          </div>

          <div
            className={cn(
              "relative z-0 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_12px_40px_rgba(0,0,0,0.35)]",
              // Satellite: let the region crop's mercator aspect drive height so
              // tall states (WA/QLD/NT/…) are not clipped by a fixed 4:3 box.
              // Map/radar: fill the centre column edge-to-edge against the side
              // panels (no centred max-width square leaving empty gutters).
              showSatelliteLoop
                ? "w-full"
                : "aspect-square w-full max-h-[min(90vh,960px)]",
            )}
          >
            <HomeMapDynamic
              mode={mode}
              regionId={regionId}
              showRadarOverlay={showRadarOverlay}
              frameTileUrl={
                showRadarOverlay && overlayRadarFrame
                  ? overlayRadarFrame.tileUrlTemplate
                  : null
              }
              frameImageUrl={
                showSatelliteLoop ? (activeFrame?.imageUrl ?? null) : null
              }
              frameImageBounds={
                showSatelliteLoop ? (activeFrame?.imageBounds ?? null) : null
              }
              frameKey={
                useSatelliteFrames && activeFrame
                  ? `${satProduct}-${regionId}-${activeFrame.time}`
                  : useRadarLoop && overlayRadarFrame
                    ? `radar-${overlayRadarFrame.time}`
                    : undefined
              }
              frameOpacity={1}
              frameAlt={
                useSatelliteFrames
                  ? `${satProductMeta.label} · ${region.label}`
                  : useRadarLoop
                    ? `Rain radar · ${region.label}`
                    : "Map frame"
              }
              mapSatelliteImageUrl={
                himawariOnMap ? (activeFrame?.imageUrl ?? null) : null
              }
              mapSatelliteImageBounds={
                himawariOnMap ? (activeFrame?.imageBounds ?? null) : null
              }
              radarLoopFrames={showRadarOverlay ? radarFrames : undefined}
              radarFrameIndex={
                useRadarLoop
                  ? frameIndex
                  : Math.max(
                      0,
                      radarFrames.findIndex(
                        (f) => f.time === overlayRadarFrame?.time,
                      ),
                    )
              }
              stormCells={stormCells}
              showStormCells={showCells}
              selectedStormCellId={selectedCellId}
              onSelectStormCell={(id) => {
                setSelectedCellId(id);
                if (id) {
                  setLayers((prev) =>
                    prev.cells ? prev : { ...prev, cells: true },
                  );
                }
              }}
              mapSettings={mapSettings}
              showLightning={showLightning}
              lightningStrikes={lightningStrikes}
              lightningReferenceTime={
                useTimeline ? (activeFrame?.time ?? null) : null
              }
              lightningTimelineStart={
                useTimeline && loopFrames.length > 0
                  ? (loopFrames[0]?.time ?? null)
                  : null
              }
              lightningTimelineEnd={
                useTimeline && loopFrames.length > 0
                  ? (loopFrames[loopFrames.length - 1]?.time ?? null)
                  : null
              }
              lightningPlaying={useTimeline && playing}
              lightningMsPerFrame={playback.msPerFrame}
              lightningNextFrameTime={
                useTimeline && loopFrames.length > 1
                  ? (loopFrames[(frameIndex + 1) % loopFrames.length]?.time ??
                    null)
                  : null
              }
              showSynoptic={showSynoptic}
              synopticFrames={synopticFrames}
              synopticGeoJson={synopticGeoJson}
              synopticValidTime={synopticValidTime}
              synopticReferenceTime={
                useTimeline ? (activeFrame?.time ?? null) : null
              }
              showStations={showStations}
              stations={weatherStations}
            />
          </div>

          {useTimeline ? (
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
                  (useSatelliteFrames &&
                    readyCount === 0 &&
                    preloadTotal > 0)
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
                            ? `Latest frame ${liveTipLabel} · checks for a new frame regularly`
                            : useRadarLoop
                              ? "Live rain radar updates"
                              : "Live satellite updates"
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
                    {useRadarLoop
                      ? "No radar frames right now — try again shortly."
                      : satProductMeta.daytimeOnly
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
                      aria-label={
                        useRadarLoop
                          ? "Rain radar timeline"
                          : `${satProductMeta.label} satellite timeline`
                      }
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
              live overlays. Enable{" "}
              <span className="font-semibold text-white">Rain radar</span> for a
              radar animation timeline,{" "}
              <span className="font-semibold text-white">Satellite imagery</span>{" "}
              for Himawari on the open map, or switch to the{" "}
              <span className="font-semibold text-white">Satellite</span> view
              for the full-frame loop.
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
                setLightningIconScale={setLightningIconScale}
              />
            </div>
          </details>
        </div>

        <div className="order-2 space-y-3 lg:order-none">
          <HomeNowPanel />

          <HomeMomentCard />

          {(focus === "radar" || showCells) && (
            <ChaseHud
              cells={stormCells}
              loading={stormCellsLoading}
              selectedId={selectedCellId}
              enabled={showCells}
              onToggle={(next) => {
                if (next) {
                  setLayers((prev) => ({
                    ...prev,
                    cells: true,
                    radar: true,
                    lightning: true,
                  }));
                } else {
                  setLayer("cells", false);
                }
              }}
              onSelect={(id) => {
                setSelectedCellId(id);
              }}
            />
          )}

          {showCells && selectedCellId ? (
            <CellDetailsPanel
              cell={
                stormCells.find((c) => c.id === selectedCellId) ?? null
              }
              onClose={() => {
                setSelectedCellId(null);
              }}
            />
          ) : null}

          <HomeWarningsPanel />

          <HomeStormTrackerPanel />

          <HomeBriefingPanel />
        </div>
      </div>

      <HomeCapitalsPanel />

      <HomeCommunityPanel />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HomeWeekPanel />

        <HomeModelComparisonPanel />

        <HomeUpperAirPanel />
      </div>
    </div>
    </HomeSydneyForecastProvider>
  );
}
