"use client";

import { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  useMap,
} from "react-leaflet";
import { LocateFixed } from "lucide-react";
import {
  CITY_MARKERS,
  type MapMode,
  type MapSettingsState,
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
import { GIBS_AU_ASPECT, GIBS_AU_BOUNDS } from "@/lib/weather/maps";
import "leaflet/dist/leaflet.css";

type Props = {
  mode: MapMode;
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
  /** Active satellite frame unix time; null = wall clock (Map/Radar or latest frame). */
  lightningReferenceTime?: number | null;
  /** Oldest/newest satellite frame times for stretching strike history. */
  lightningTimelineStart?: number | null;
  lightningTimelineEnd?: number | null;
  /** Windy-style continuous trail while the IR loop is playing. */
  lightningPlaying?: boolean;
  lightningMsPerFrame?: number;
  lightningNextFrameTime?: number | null;
  showSynoptic?: boolean;
  synopticFrames?: SynopticFrame[];
  synopticGeoJson?: SynopticGeoJson | null;
  synopticValidTime?: number | null;
  /** Frame time for chart pick; null = wall clock. */
  synopticReferenceTime?: number | null;
};

function MapModeEffect({ mode }: { mode: MapMode }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().dataset.mapMode = mode;
  }, [map, mode]);
  return null;
}

function MapTools() {
  const map = useMap();
  return (
    <div className="absolute left-3 top-3 z-[1000] flex flex-col gap-2">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center border border-[var(--brand)]/20 bg-[var(--bom-blue)] text-[var(--brand)] shadow transition hover:bg-[var(--navy-deep)] hover:text-[var(--brand)]"
        aria-label="Recentre on Australia"
        onClick={() => map.setView([-25.5, 134.5], 4, { animate: true })}
      >
        <LocateFixed className="h-4 w-4" />
      </button>
    </div>
  );
}

function FitAuBounds() {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(GIBS_AU_BOUNDS, { animate: false, padding: [0, 0] });
    const onResize = () => {
      map.invalidateSize({ animate: false });
      map.fitBounds(GIBS_AU_BOUNDS, { animate: false, padding: [0, 0] });
    };
    map.whenReady(onResize);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map]);
  return null;
}

function DemoRadarBlobs() {
  // Fallback only when RainViewer tiles fail to load — soft demo cells.
  const cells = [
    { lat: -28.2, lon: 152.8, color: "#22c55e" },
    { lat: -29.1, lon: 151.9, color: "#eab308" },
    { lat: -30.4, lon: 150.6, color: "#ef4444" },
    { lat: -32.6, lon: 151.2, color: "#84cc16" },
    { lat: -33.5, lon: 150.4, color: "#f59e0b" },
    { lat: -26.8, lon: 152.1, color: "#22c55e" },
  ];
  return (
    <>
      {cells.map((cell, i) => (
        <CircleMarker
          key={i}
          center={[cell.lat, cell.lon]}
          radius={18 + (i % 3) * 6}
          pathOptions={{
            color: cell.color,
            fillColor: cell.color,
            fillOpacity: 0.35,
            weight: 1,
            opacity: 0.7,
          }}
        />
      ))}
    </>
  );
}

/**
 * RainViewer tiles over the fixed Himawari frame. Same EPSG:3857 crop as GIBS
 * so radar cells line up with the IR image without converting satellite to Leaflet.
 */
function SatelliteRadarOverlay({ tileUrl }: { tileUrl: string }) {
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
        <FitAuBounds />
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

export function HomeMap({
  mode,
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
  const satelliteLoop = mode === "Satellite";
  const radarTiles =
    frameTileUrl && (showRadarOverlay || mode === "Radar") ? frameTileUrl : null;

  const basemapUrl =
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";

  // Satellite: full-bleed image, no zoom/pan, fills the border with no letterbox
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
          <SatelliteRadarOverlay tileUrl={frameTileUrl} />
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
        key="map-free"
        center={[-25.5, 134.5]}
        zoom={4}
        minZoom={3}
        maxZoom={16}
        className="h-full w-full"
        zoomControl={false}
        attributionControl
      >
        <MapModeEffect mode={mode} />
        <TileLayer url={basemapUrl} attribution="Esri" />
        {radarTiles ? (
          <TileLayer url={radarTiles} opacity={0.78} />
        ) : mode === "Radar" ? (
          <DemoRadarBlobs />
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
        <MapTools />
      </MapContainer>
    </div>
  );
}
