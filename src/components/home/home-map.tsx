"use client";

import { useEffect, useState } from "react";
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
  LightningLegend,
  SatelliteLightningOverlay,
} from "@/components/home/lightning-overlay";
import {
  LeafletSynopticOverlay,
  SatelliteSynopticOverlay,
  SynopticLegend,
} from "@/components/home/synoptic-overlay";
import { SatelliteMapAnnotations } from "@/components/home/satellite-map-annotations";
import type { LightningStrike } from "@/lib/weather/lightning";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import { GIBS_AU_ASPECT } from "@/lib/weather/maps";
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
  legend?: "radar" | "satellite" | null;
  mapSettings: MapSettingsState;
  showLightning?: boolean;
  lightningStrikes?: LightningStrike[];
  lightningAttribution?: string | null;
  lightningStatus?: "connecting" | "live" | "reconnecting" | "error" | null;
  lightningLive?: boolean;
  /** Active satellite frame unix time; null = wall clock (Map/Radar or latest frame). */
  lightningReferenceTime?: number | null;
  /** True while Satellite loop is active (legend: synced to frame). */
  lightningFrameSynced?: boolean;
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
  synopticAttribution?: string | null;
  synopticLoading?: boolean;
  synopticError?: string | null;
  /** Frame time for chart pick; null = wall clock. */
  synopticReferenceTime?: number | null;
  /** True while Satellite loop drives the synoptic valid time. */
  synopticFrameSynced?: boolean;
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

function DemoRadarBlobs() {
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
 * Double-buffered frame view: keep the last good frame painted while the next
 * image downloads/decodes, then swap atomically to avoid black flashes.
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
  const [displayUrl, setDisplayUrl] = useState<string | null>(url);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setDisplayUrl(null);
      setPendingUrl(null);
      return;
    }
    if (url === displayUrl) return;

    let cancelled = false;
    setPendingUrl(url);
    const img = new window.Image();
    img.decoding = "async";
    const commit = () => {
      if (cancelled) return;
      setDisplayUrl(url);
      setPendingUrl(null);
    };
    img.onload = () => {
      if (typeof img.decode === "function") {
        void img.decode().then(commit).catch(commit);
      } else {
        commit();
      }
    };
    img.onerror = () => {
      if (!cancelled) setPendingUrl(null);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, displayUrl]);

  if (!displayUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#0a1628] text-sm text-white/70">
        {pendingUrl ? "Loading frame…" : "Loading satellite frames…"}
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
  frameImageUrl = null,
  frameOpacity = 1,
  frameAlt = "Satellite loop frame",
  legend = null,
  mapSettings,
  showLightning = false,
  lightningStrikes = [],
  lightningAttribution = null,
  lightningStatus = null,
  lightningLive = false,
  lightningReferenceTime = null,
  lightningFrameSynced = false,
  lightningTimelineStart = null,
  lightningTimelineEnd = null,
  lightningPlaying = false,
  lightningMsPerFrame = 500,
  lightningNextFrameTime = null,
  showSynoptic = false,
  synopticFrames = [],
  synopticGeoJson = null,
  synopticValidTime = null,
  synopticAttribution = null,
  synopticLoading = false,
  synopticError = null,
  synopticReferenceTime = null,
  synopticFrameSynced = false,
}: Props) {
  const satelliteLoop = mode === "Satellite";

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
        {showSynoptic ? (
          <SynopticLegend
            frames={synopticFrames}
            attribution={synopticAttribution}
            referenceTime={synopticReferenceTime}
            loading={synopticLoading}
            error={synopticError}
            validTime={synopticValidTime}
            frameSynced={synopticFrameSynced}
          />
        ) : null}
        {showLightning ? (
          <LightningLegend
            strikes={lightningStrikes}
            attribution={lightningAttribution}
            status={lightningStatus}
            live={lightningLive}
            referenceTime={lightningReferenceTime}
            frameSynced={lightningFrameSynced}
            timelineStart={lightningTimelineStart}
            timelineEnd={lightningTimelineEnd}
            playing={lightningPlaying}
            msPerFrame={lightningMsPerFrame}
            nextFrameTime={lightningNextFrameTime}
          />
        ) : null}
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
        {frameTileUrl ? (
          <TileLayer key={frameTileUrl} url={frameTileUrl} opacity={0.75} />
        ) : null}
        {showRadarOverlay || mode === "Radar" ? <DemoRadarBlobs /> : null}
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

      {showSynoptic ? (
        <SynopticLegend
          frames={synopticFrames}
          attribution={synopticAttribution}
          referenceTime={synopticReferenceTime}
          loading={synopticLoading}
          error={synopticError}
          validTime={synopticValidTime}
          frameSynced={synopticFrameSynced}
        />
      ) : null}

      {showLightning ? (
        <LightningLegend
          strikes={lightningStrikes}
          attribution={lightningAttribution}
          status={lightningStatus}
          live={lightningLive}
          referenceTime={lightningReferenceTime}
          frameSynced={lightningFrameSynced}
          timelineStart={lightningTimelineStart}
          timelineEnd={lightningTimelineEnd}
          playing={lightningPlaying}
          msPerFrame={lightningMsPerFrame}
          nextFrameTime={lightningNextFrameTime}
        />
      ) : null}

      {legend === "radar" || (showRadarOverlay && mode === "Radar") ? (
        <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] border border-[var(--brand)]/20 bg-[var(--bom-blue)]/95 px-3 py-2 text-[var(--brand)]">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--brand)]/80">
            Radar intensity
          </p>
          <div className="flex h-2 w-36 overflow-hidden">
            <span className="flex-1 bg-emerald-400" />
            <span className="flex-1 bg-lime-400" />
            <span className="flex-1 bg-yellow-400" />
            <span className="flex-1 bg-orange-400" />
            <span className="flex-1 bg-red-500" />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-[var(--brand)]/75">
            <span>Light</span>
            <span>Heavy</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
