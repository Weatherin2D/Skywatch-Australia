"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  ImageOverlay,
  useMap,
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
import type { LightningStrike } from "@/lib/weather/lightning";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import {
  GIBS_AU_ASPECT,
  GIBS_AU_BOUNDS,
  boundsMercatorAspect,
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
};

function MapModeEffect({ mode }: { mode: MapMode }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().dataset.mapMode = mode;
  }, [map, mode]);
  return null;
}

function FitRegionBounds({
  bounds,
  animate = true,
  padding = 24,
}: {
  bounds: RegionBounds;
  animate?: boolean;
  padding?: number;
}) {
  const map = useMap();
  const key = `${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`;
  useEffect(() => {
    map.fitBounds(bounds, {
      animate,
      padding: [padding, padding],
    });
    const onResize = () => {
      map.invalidateSize({ animate: false });
      map.fitBounds(bounds, { animate: false, padding: [padding, padding] });
    };
    map.whenReady(onResize);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map, key, animate, padding, bounds]);
  return null;
}

function MapTools({ bounds }: { bounds: RegionBounds }) {
  const map = useMap();
  return (
    <div className="absolute left-3 top-3 z-[1000] flex flex-col gap-2">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center border border-[var(--brand)]/20 bg-[var(--bom-blue)] text-[var(--brand)] shadow transition hover:bg-[var(--navy-deep)] hover:text-[var(--brand)]"
        aria-label="Recentre on selected region"
        onClick={() =>
          map.fitBounds(bounds, { animate: true, padding: [24, 24] })
        }
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
        <FitRegionBounds bounds={bounds} animate={false} padding={0} />
        <TileLayer url={tileUrl} opacity={0.72} />
      </MapContainer>
    </div>
  );
}

/**
 * Hold the last good frame until the next URL is ready. Cached images commit
 * immediately so fixed-cadence playback does not wait on decode.
 */
function SatelliteFrameView({
  url,
  alt,
  opacity = 1,
}: {
  url: string | null;
  alt: string;
  opacity?: number;
}) {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const displayRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url) {
      displayRef.current = null;
      setDisplayUrl(null);
      setFailed(false);
      return;
    }
    if (url === displayRef.current) {
      setFailed(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const commit = () => {
      if (cancelled) return;
      displayRef.current = url;
      setDisplayUrl(url);
      setFailed(false);
    };

    const load = () => {
      attempts += 1;
      const img = new window.Image();
      const src = attempts === 1 ? url : `${url}&retry=${attempts}`;
      img.onload = commit;
      img.onerror = () => {
        if (cancelled) return;
        if (attempts < 2) {
          window.setTimeout(load, 400);
          return;
        }
        if (!displayRef.current) setFailed(true);
      };
      img.src = src;
      if (img.complete && img.naturalWidth > 0) {
        commit();
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!displayUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#0a1628] px-4 text-center text-sm text-white/70">
        {failed
          ? "Satellite frame unavailable — scrub or wait for the next refresh…"
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

function RegionalSatelliteView({
  bounds,
  frameImageUrl,
  frameAlt,
  frameOpacity,
  frameTileUrl,
  showRadarOverlay,
  mapSettings,
  showLightning,
  lightningStrikes,
  lightningReferenceTime,
  lightningTimelineStart,
  lightningTimelineEnd,
  lightningPlaying,
  lightningMsPerFrame,
  lightningNextFrameTime,
  showSynoptic,
  synopticFrames,
  synopticGeoJson,
  synopticValidTime,
  synopticReferenceTime,
}: {
  bounds: RegionBounds;
  frameImageUrl: string | null;
  frameAlt: string;
  frameOpacity: number;
  frameTileUrl: string | null;
  showRadarOverlay: boolean;
  mapSettings: MapSettingsState;
  showLightning: boolean;
  lightningStrikes: LightningStrike[];
  lightningReferenceTime: number | null;
  lightningTimelineStart: number | null;
  lightningTimelineEnd: number | null;
  lightningPlaying: boolean;
  lightningMsPerFrame: number;
  lightningNextFrameTime: number | null;
  showSynoptic: boolean;
  synopticFrames: SynopticFrame[];
  synopticGeoJson: SynopticGeoJson | null;
  synopticValidTime: number | null;
  synopticReferenceTime: number | null;
}) {
  const aspect = useMemo(() => boundsMercatorAspect(bounds), [bounds]);
  const [displayUrl, setDisplayUrl] = useState<string | null>(frameImageUrl);

  useEffect(() => {
    if (!frameImageUrl) {
      setDisplayUrl(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) setDisplayUrl(frameImageUrl);
    };
    img.onerror = () => {
      /* keep previous */
    };
    img.src = frameImageUrl;
    if (img.complete && img.naturalWidth > 0) setDisplayUrl(frameImageUrl);
    return () => {
      cancelled = true;
    };
  }, [frameImageUrl]);

  return (
    <div
      className="skywatch-map relative w-full overflow-hidden bg-black"
      style={{ aspectRatio: String(aspect) }}
      data-map-mode="Satellite"
    >
      <MapContainer
        key={`sat-region-${bounds[0][0]}-${bounds[1][1]}`}
        center={[-25.5, 134.5]}
        zoom={5}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={false}
        maxBounds={bounds}
        maxBoundsViscosity={0.85}
      >
        <FitRegionBounds bounds={bounds} animate padding={8} />
        {displayUrl ? (
          <ImageOverlay
            key={displayUrl}
            url={displayUrl}
            bounds={bounds}
            opacity={frameOpacity}
            zIndex={200}
          />
        ) : (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            attribution="Esri"
          />
        )}
        {showRadarOverlay && frameTileUrl ? (
          <TileLayer url={frameTileUrl} opacity={0.72} zIndex={350} />
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
        />
        <MapTools bounds={bounds} />
      </MapContainer>
      {!displayUrl ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white/80">
          Loading {frameAlt}…
        </div>
      ) : null}
    </div>
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
}: Props) {
  const region = getMapRegion(regionId);
  const bounds = region.bounds;
  const isNational = regionId === "national";
  const satelliteLoop = mode === "Satellite";
  const radarTiles = frameTileUrl && showRadarOverlay ? frameTileUrl : null;

  const basemapUrl =
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";

  if (satelliteLoop && !isNational) {
    return (
      <RegionalSatelliteView
        bounds={bounds}
        frameImageUrl={frameImageUrl}
        frameAlt={frameAlt}
        frameOpacity={frameOpacity}
        frameTileUrl={frameTileUrl}
        showRadarOverlay={showRadarOverlay}
        mapSettings={mapSettings}
        showLightning={showLightning}
        lightningStrikes={lightningStrikes}
        lightningReferenceTime={lightningReferenceTime}
        lightningTimelineStart={lightningTimelineStart}
        lightningTimelineEnd={lightningTimelineEnd}
        lightningPlaying={lightningPlaying}
        lightningMsPerFrame={lightningMsPerFrame}
        lightningNextFrameTime={lightningNextFrameTime}
        showSynoptic={showSynoptic}
        synopticFrames={synopticFrames}
        synopticGeoJson={synopticGeoJson}
        synopticValidTime={synopticValidTime}
        synopticReferenceTime={synopticReferenceTime}
      />
    );
  }

  // National satellite: full-bleed image, no zoom/pan
  if (satelliteLoop) {
    return (
      <div
        className="skywatch-map relative w-full overflow-hidden bg-black"
        style={{ aspectRatio: String(GIBS_AU_ASPECT) }}
        data-map-mode="Satellite"
      >
        <SatelliteFrameView
          url={frameImageUrl}
          alt={frameAlt}
          opacity={frameOpacity}
        />
        {showRadarOverlay && frameTileUrl ? (
          <SatelliteRadarOverlay
            tileUrl={frameTileUrl}
            bounds={GIBS_AU_BOUNDS}
          />
        ) : null}
        <SatelliteSynopticOverlay
          frames={synopticFrames}
          enabled={showSynoptic}
          referenceTime={synopticReferenceTime}
          geojson={synopticGeoJson}
          validTime={synopticValidTime}
        />
        <SatelliteMapAnnotations
          settings={mapSettings}
          cities={CITY_MARKERS}
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
        />
      </div>
    );
  }

  return (
    <div className="skywatch-map relative h-full min-h-[360px] w-full overflow-hidden">
      <MapContainer
        key={`map-${regionId}`}
        center={[-25.5, 134.5]}
        zoom={4}
        minZoom={3}
        maxZoom={16}
        className="h-full w-full"
        zoomControl={false}
        attributionControl
      >
        <MapModeEffect mode={mode} />
        <FitRegionBounds bounds={bounds} animate padding={isNational ? 8 : 28} />
        <TileLayer url={basemapUrl} attribution="Esri" />
        {radarTiles ? <TileLayer url={radarTiles} opacity={0.78} /> : null}
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
        />
        <MapTools bounds={bounds} />
      </MapContainer>
    </div>
  );
}
