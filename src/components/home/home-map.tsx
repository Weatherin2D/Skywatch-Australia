"use client";

import { useEffect, useRef, useState } from "react";
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { LocateFixed } from "lucide-react";
import {
  CITY_MARKERS,
  DEFAULT_MAP_REGION,
  getMapRegion,
  type MapMode,
  type MapRegionId,
  type MapSettingsState,
  type RegionBounds,
} from "@/components/home/mock-data";
import { LeafletMapAnnotations } from "@/components/home/leaflet-map-annotations";
import {
  LeafletLightningOverlay,
  SatelliteLightningOverlay,
} from "@/components/home/lightning-overlay";
import {
  LeafletSynopticOverlay,
  SatelliteSynopticOverlay,
} from "@/components/home/synoptic-overlay";
import { SatelliteMapAnnotations } from "@/components/home/satellite-map-annotations";
import { MapFullscreenButton } from "@/components/home/map-fullscreen";
import { MapChromeFix } from "@/components/home/map-chrome-fix";
import {
  RadarFramePreloader,
  SmoothRadarLayer,
} from "@/components/home/smooth-radar-layer";
import { RiskPolygonLayer } from "@/components/risk/risk-polygon-layer";
import { StormCellOverlay } from "@/components/home/storm-cell-overlay";
import type { DisplayFeature } from "@/lib/forecast/types";
import type { LightningStrike } from "@/lib/weather/lightning";
import type { StormCell } from "@/lib/weather/storm-cell-types";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import {
  GIBS_AU_ASPECT,
  boundsMercatorAspect,
  type WeatherFrame,
} from "@/lib/weather/maps";
import "leaflet/dist/leaflet.css";

type Props = {
  mode: MapMode;
  regionId?: MapRegionId;
  showRadarOverlay?: boolean;
  /** Leaflet tile URL template for RainViewer frames */
  frameTileUrl?: string | null;
  /** Full-frame IR image (GIBS WMS via proxy) */
  frameImageUrl?: string | null;
  /** Optional live/proxy URL if the primary frame fails to load. */
  frameImageFallbackUrl?: string | null;
  frameImageBounds?: [[number, number], [number, number]] | null;
  frameKey?: string | number;
  frameOpacity?: number;
  frameAlt?: string;
  mapSettings: MapSettingsState;
  showLightning?: boolean;
  lightningStrikes?: LightningStrike[];
  /** Active satellite frame unix time; null = wall clock. */
  lightningReferenceTime?: number | null;
  lightningTimelineStart?: number | null;
  lightningTimelineEnd?: number | null;
  lightningPlaying?: boolean;
  lightningMsPerFrame?: number;
  lightningNextFrameTime?: number | null;
  showSynoptic?: boolean;
  synopticFrames?: SynopticFrame[];
  synopticGeoJson?: SynopticGeoJson | null;
  synopticValidTime?: number | null;
  synopticReferenceTime?: number | null;
  /** Latest Himawari frame for Map-mode satellite overlay (optional). */
  mapSatelliteImageUrl?: string | null;
  mapSatelliteImageBounds?: [[number, number], [number, number]] | null;
  /** Radar timeline frames for prefetch / smooth playback. */
  radarLoopFrames?: WeatherFrame[];
  radarFrameIndex?: number;
  /** Official BoM thunderstorm forecast chart (risk page). */
  riskImageUrl?: string | null;
  riskImageBounds?: [[number, number], [number, number]] | null;
  /** sheet = product graphic over map; geo = georeferenced plate */
  riskImageDisplay?: "sheet" | "geo";
  riskImageOpacity?: number;
  /** Convective risk polygons (Day 1–3 outlook). */
  riskFeatures?: DisplayFeature[];
  /** Optional map click probe (e.g. ECMWF models page). */
  onMapClick?: (ll: { lat: number; lng: number }) => void;
  probePoint?: {
    lat: number;
    lng: number;
    label?: string | null;
  } | null;
  /** Optional second probe / transect end. */
  probePointB?: {
    lat: number;
    lng: number;
    label?: string | null;
  } | null;
  /** Draw a transect line between A and B when both set. */
  showTransectLine?: boolean;
  stormCells?: StormCell[];
  showStormCells?: boolean;
  selectedStormCellId?: string | null;
  focusStormCellId?: string | null;
  onSelectStormCell?: (id: string | null) => void;
};

function MapClickHandler({
  onMapClick,
}: {
  onMapClick?: (ll: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function MapModeEffect({ mode }: { mode: MapMode }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().dataset.mapMode = mode;
  }, [map, mode]);
  return null;
}

function regionFitPaddingPx(isNational: boolean, width: number): number {
  // Keep padding light on narrow phones so tall/wide states still fit fully.
  if (isNational) return width < 640 ? 4 : 8;
  if (width < 480) return 8;
  if (width < 768) return 14;
  return 28;
}

function FitRegionBounds({
  bounds,
  animate = true,
  isNational = false,
  padding,
}: {
  bounds: RegionBounds;
  animate?: boolean;
  isNational?: boolean;
  /** Fixed padding override; when omitted, scales down on mobile. */
  padding?: number;
}) {
  const map = useMap();
  const key = `${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`;
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const regionChanged = lastKeyRef.current !== key;
    if (regionChanged) {
      lastKeyRef.current = key;
    }

    const fit = (withAnimate: boolean) => {
      const pad =
        padding ??
        regionFitPaddingPx(
          isNational,
          map.getContainer().clientWidth || window.innerWidth,
        );
      map.fitBounds(bounds, {
        animate: withAnimate,
        padding: [pad, pad],
        // Avoid over-zooming ACT/TAS on tall phones and clipping edges.
        maxZoom: isNational ? 6 : 9,
      });
    };

    // Only auto-fit when the region changes (or first mount). Resize / layout
    // shifts must not yank a zoomed-in radar view back to national framing.
    if (regionChanged) {
      fit(animate);
    }

    const onResize = () => {
      map.invalidateSize({ animate: false });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map, key, animate, padding, bounds, isNational]);
  return null;
}

function MapTools({
  bounds,
  isNational,
  fullscreenTarget,
}: {
  bounds: RegionBounds;
  isNational: boolean;
  fullscreenTarget: HTMLElement | null;
}) {
  const map = useMap();

  useEffect(() => {
    const onFs = () => {
      window.setTimeout(() => map.invalidateSize({ animate: false }), 80);
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, [map]);

  return (
    <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-2">
      <MapFullscreenButton target={fullscreenTarget} compact />
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-[#0f172a]/90 text-white shadow-lg backdrop-blur-md transition hover:border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/15 hover:text-[var(--cyan)]"
        aria-label="Recentre on selected region"
        onClick={() => {
          const pad = regionFitPaddingPx(
            isNational,
            map.getContainer().clientWidth || window.innerWidth,
          );
          map.fitBounds(bounds, {
            animate: true,
            padding: [pad, pad],
            maxZoom: isNational ? 6 : 9,
          });
        }}
      >
        <LocateFixed className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * RainViewer tiles over the fixed national Himawari frame.
 */
function SatelliteRadarOverlay({
  tileUrl,
  bounds,
}: {
  tileUrl: string;
  bounds: RegionBounds;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[4]">
      <MapContainer
        center={[-25.5, 134.5]}
        zoom={4}
        className="h-full w-full !bg-transparent [&_.leaflet-container]:!bg-transparent [&_.leaflet-tile-pane]:!opacity-100"
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        doubleClickZoom={false}
        scrollWheelZoom={false}
        boxZoom={false}
        keyboard={false}
        touchZoom={false}
        style={{ background: "transparent" }}
      >
        <MapChromeFix />
        <FitRegionBounds
          bounds={bounds}
          animate={false}
          padding={0}
          isNational={false}
        />
        <SmoothRadarLayer url={tileUrl} opacity={0.88} />
      </MapContainer>
    </div>
  );
}

/**
 * Hold the last good frame until the next URL is ready — but only within the
 * same product/region loop. Crossing products must clear immediately so IR
 * never keeps showing Air Mass / Visible while the next loop buffers.
 */
function SatelliteFrameView({
  url,
  alt,
  opacity = 1,
  loopKey,
  fallbackUrl = null,
}: {
  url: string | null;
  alt: string;
  opacity?: number;
  /** Product + region identity; changing this drops any held frame. */
  loopKey?: string;
  /** Tried after primary URL exhausts retries (e.g. live frame proxy). */
  fallbackUrl?: string | null;
}) {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const displayRef = useRef<string | null>(null);
  const loadingRef = useRef<string | null>(null);
  const loopKeyRef = useRef(loopKey);
  const loadGenRef = useRef(0);

  useEffect(() => {
    if (loopKeyRef.current === loopKey) return;
    loopKeyRef.current = loopKey;
    displayRef.current = null;
    loadingRef.current = null;
    loadGenRef.current += 1;
    setDisplayUrl(null);
    setFailed(false);
  }, [loopKey]);

  useEffect(() => {
    if (!url) {
      // Keep last decoded frame if the URL briefly goes null during scrub.
      loadingRef.current = null;
      setFailed(false);
      return;
    }
    if (url === displayRef.current || url === loadingRef.current) {
      setFailed(false);
      return;
    }

    const gen = ++loadGenRef.current;
    let attempts = 0;
    let usingFallback = false;
    let activeUrl = url;
    loadingRef.current = url;
    setFailed(false);
    const isArchive = url.includes("/api/weather/archive/frame");
    const maxAttempts = isArchive ? 3 : 2;
    const retryDelayMs = isArchive ? 900 : 400;

    const commit = (committedUrl: string) => {
      if (gen !== loadGenRef.current) return;
      displayRef.current = committedUrl;
      loadingRef.current = null;
      setDisplayUrl(committedUrl);
      setFailed(false);
    };

    const load = () => {
      if (gen !== loadGenRef.current) return;
      attempts += 1;
      const img = new window.Image();
      const src =
        attempts === 1 ? activeUrl : `${activeUrl}&retry=${attempts}`;
      img.onload = () => commit(activeUrl);
      img.onerror = () => {
        if (gen !== loadGenRef.current) return;
        if (attempts < maxAttempts) {
          window.setTimeout(load, retryDelayMs);
          return;
        }
        if (!usingFallback && fallbackUrl) {
          usingFallback = true;
          attempts = 0;
          activeUrl = fallbackUrl;
          window.setTimeout(load, 120);
          return;
        }
        loadingRef.current = null;
        // Never blank a previously good frame — hold it to avoid flicker.
        setFailed(!displayRef.current);
      };
      img.src = src;
      if (img.complete && img.naturalWidth > 0) {
        commit(activeUrl);
      }
    };

    load();
    return () => {
      if (loadingRef.current === url) loadingRef.current = null;
    };
  }, [url, fallbackUrl]);

  if (!displayUrl) {
    const archive = url?.includes("/api/weather/archive/frame");
    return (
      <div className="absolute inset-0 z-[1] flex items-center justify-center bg-[#0a1628] px-4 text-center text-sm text-white/70">
        {failed
          ? archive
            ? "Archive frame still capturing — scrub slightly or wait a moment…"
            : "Satellite frame unavailable — scrub or wait for the next refresh…"
          : archive
            ? "Loading archive frame…"
            : "Loading satellite frames…"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displayUrl}
      alt={alt}
      className="absolute inset-0 h-full w-full object-fill select-none"
      style={{ opacity }}
      draggable={false}
    />
  );
}

export function HomeMap({
  mode,
  regionId = DEFAULT_MAP_REGION,
  showRadarOverlay = false,
  frameTileUrl = null,
  frameOpacity = 1,
  frameAlt = "Satellite loop frame",
  frameImageUrl = null,
  frameImageFallbackUrl = null,
  frameKey,
  mapSettings,
  showLightning = false,
  lightningStrikes = [],
  lightningReferenceTime = null,
  lightningTimelineStart = null,
  lightningTimelineEnd = null,
  lightningPlaying = false,
  lightningMsPerFrame = 500,
  lightningNextFrameTime = null,
  showSynoptic = false,
  synopticFrames = [],
  synopticGeoJson = null,
  synopticValidTime = null,
  synopticReferenceTime = null,
  mapSatelliteImageUrl = null,
  mapSatelliteImageBounds = null,
  radarLoopFrames = [],
  radarFrameIndex = 0,
  riskImageUrl = null,
  riskImageBounds = null,
  riskImageDisplay = "sheet",
  riskImageOpacity = 0.92,
  riskFeatures = [],
  onMapClick,
  probePoint = null,
  probePointB = null,
  showTransectLine = false,
  stormCells = [],
  showStormCells = false,
  selectedStormCellId = null,
  focusStormCellId = null,
  onSelectStormCell,
}: Props) {
  const region = getMapRegion(regionId);
  const bounds = region.bounds;
  const isNational = regionId === "national";
  const satelliteLoop = mode === "Satellite";
  const radarTiles = frameTileUrl && showRadarOverlay ? frameTileUrl : null;
  const satAspect = isNational
    ? GIBS_AU_ASPECT
    : boundsMercatorAspect(bounds);
  const useSatelliteBasemap = mapSettings.satelliteBasemap;
  const lightningIconStyle = mapSettings.lightningBolts
    ? ("bolt" as const)
    : ("crosshair" as const);
  const mapShellRef = useRef<HTMLDivElement>(null);
  const [fullscreenTarget, setFullscreenTarget] = useState<HTMLElement | null>(
    null,
  );

  useEffect(() => {
    setFullscreenTarget(mapShellRef.current);
  }, [satelliteLoop, regionId]);

  // Esri Canvas dark base. Unloaded areas must stay navy (not Leaflet #ddd) —
  // see globals.css. keepBuffer + updateWhenZooming:false cut grey flash on pan.
  const basemapUrl = useSatelliteBasemap
    ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
  const basemapAttr = useSatelliteBasemap ? "Esri World Imagery" : "Esri";
  const darkTilePlaceholder =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  // Satellite: full-bleed region crop (national or state) — image is already
  // georeferenced to `bounds`, so CSS overlays use the same projection.
  // Aspect must match the crop so mobile viewports don't clip the state.
  if (satelliteLoop) {
    return (
      <div
        ref={mapShellRef}
        className="skywatch-map relative z-0 w-full overflow-hidden bg-black"
        style={{ aspectRatio: `${satAspect}` }}
        data-map-mode="Satellite"
        data-region={regionId}
      >
        <div className="absolute right-3 top-3 z-[20]">
          <MapFullscreenButton target={fullscreenTarget} compact />
        </div>
        <SatelliteFrameView
          key={
            typeof frameKey === "string"
              ? frameKey.replace(/-\d+$/, "")
              : regionId
          }
          loopKey={
            typeof frameKey === "string"
              ? frameKey.replace(/-\d+$/, "")
              : String(regionId)
          }
          url={frameImageUrl}
          fallbackUrl={frameImageFallbackUrl}
          alt={frameAlt}
          opacity={frameOpacity}
        />
        {showRadarOverlay && frameTileUrl ? (
          <SatelliteRadarOverlay tileUrl={frameTileUrl} bounds={bounds} />
        ) : null}
        <SatelliteSynopticOverlay
          frames={synopticFrames}
          enabled={showSynoptic}
          referenceTime={synopticReferenceTime}
          geojson={synopticGeoJson}
          validTime={synopticValidTime}
          bounds={bounds}
        />
        <SatelliteMapAnnotations
          settings={mapSettings}
          cities={CITY_MARKERS}
          bounds={bounds}
        />
        <SatelliteLightningOverlay
          strikes={lightningStrikes}
          enabled={showLightning}
          referenceTime={lightningReferenceTime}
          timelineStart={lightningTimelineStart}
          timelineEnd={lightningTimelineEnd}
          playing={lightningPlaying}
          msPerFrame={lightningMsPerFrame}
          nextFrameTime={lightningNextFrameTime}
          bounds={bounds}
          iconStyle={lightningIconStyle}
        />
      </div>
    );
  }

  return (
    <div
      ref={mapShellRef}
      className="skywatch-map relative z-0 h-full min-h-[360px] w-full overflow-hidden"
    >
      <MapContainer
        center={[-25.5, 134.5]}
        zoom={4}
        minZoom={3}
        maxZoom={18}
        className="h-full w-full !bg-[#0a1628]"
        style={{ background: "#0a1628" }}
        zoomControl={false}
        attributionControl
        fadeAnimation={false}
      >
        <MapChromeFix />
        <MapModeEffect mode={mode} />
        <MapClickHandler onMapClick={onMapClick} />
        <FitRegionBounds bounds={bounds} animate isNational={isNational} />
        <TileLayer
          key={useSatelliteBasemap ? "sat" : "esri-dark"}
          url={basemapUrl}
          attribution={basemapAttr}
          keepBuffer={16}
          updateWhenZooming={false}
          updateWhenIdle
          maxZoom={18}
          maxNativeZoom={16}
          errorTileUrl={darkTilePlaceholder}
          crossOrigin
        />
        {mapSatelliteImageUrl && mapSatelliteImageBounds ? (
          <ImageOverlay
            key={mapSatelliteImageUrl}
            url={mapSatelliteImageUrl}
            bounds={mapSatelliteImageBounds}
            opacity={useSatelliteBasemap ? 0.55 : 0.82}
            zIndex={350}
            className="skywatch-map-himawari"
          />
        ) : null}
        {riskImageUrl &&
        riskImageDisplay === "geo" &&
        riskImageBounds ? (
          <ImageOverlay
            key={riskImageUrl}
            url={riskImageUrl}
            bounds={riskImageBounds}
            opacity={riskImageOpacity}
            zIndex={420}
            className="skywatch-risk-chart"
          />
        ) : null}
        {radarTiles ? <SmoothRadarLayer url={radarTiles} opacity={0.9} /> : null}
        {showRadarOverlay && radarLoopFrames.length > 0 ? (
          <RadarFramePreloader
            frames={radarLoopFrames}
            activeIndex={radarFrameIndex}
            enabled
          />
        ) : null}
        {riskFeatures.length > 0 ? (
          <RiskPolygonLayer features={riskFeatures} fit={false} />
        ) : null}
        <LeafletSynopticOverlay
          frames={synopticFrames}
          enabled={showSynoptic}
          referenceTime={synopticReferenceTime}
          geojson={synopticGeoJson}
          validTime={synopticValidTime}
        />
        <LeafletMapAnnotations settings={mapSettings} />
        <LeafletLightningOverlay
          strikes={lightningStrikes}
          enabled={showLightning}
          referenceTime={lightningReferenceTime}
          timelineStart={lightningTimelineStart}
          timelineEnd={lightningTimelineEnd}
          playing={lightningPlaying}
          msPerFrame={lightningMsPerFrame}
          nextFrameTime={lightningNextFrameTime}
          iconStyle={lightningIconStyle}
        />
        {probePoint ? (
          <CircleMarker
            center={[probePoint.lat, probePoint.lng]}
            radius={9}
            pathOptions={{
              color: "#22d3ee",
              weight: 2,
              fillColor: "#22d3ee",
              fillOpacity: 0.35,
            }}
          >
            {probePoint.label ? (
              <Tooltip permanent direction="top" offset={[0, -8]}>
                {probePoint.label}
              </Tooltip>
            ) : null}
          </CircleMarker>
        ) : null}
        {probePointB ? (
          <CircleMarker
            center={[probePointB.lat, probePointB.lng]}
            radius={9}
            pathOptions={{
              color: "#fbbf24",
              weight: 2,
              fillColor: "#fbbf24",
              fillOpacity: 0.35,
            }}
          >
            {probePointB.label ? (
              <Tooltip permanent direction="top" offset={[0, -8]}>
                {probePointB.label}
              </Tooltip>
            ) : null}
          </CircleMarker>
        ) : null}
        {showTransectLine && probePoint && probePointB ? (
          <Polyline
            positions={[
              [probePoint.lat, probePoint.lng],
              [probePointB.lat, probePointB.lng],
            ]}
            pathOptions={{
              color: "#fbbf24",
              weight: 2.5,
              dashArray: "6 4",
              opacity: 0.9,
            }}
          />
        ) : null}
        <StormCellOverlay
          cells={stormCells}
          enabled={showStormCells}
          selectedId={selectedStormCellId}
          focusId={focusStormCellId}
          onSelect={onSelectStormCell}
        />
        <MapTools
          bounds={bounds}
          isNational={isNational}
          fullscreenTarget={fullscreenTarget}
        />
      </MapContainer>
      {riskImageUrl && riskImageDisplay === "sheet" ? (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-[#070b16]/55 p-3 sm:p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={riskImageUrl}
            alt="BoM thunderstorm forecast"
            className="max-h-full max-w-full object-contain shadow-[0_12px_48px_rgba(0,0,0,0.55)]"
            draggable={false}
          />
        </div>
      ) : null}
    </div>
  );
}
