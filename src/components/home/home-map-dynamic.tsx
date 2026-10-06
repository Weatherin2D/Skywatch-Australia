"use client";

import dynamic from "next/dynamic";
import type {
  MapMode,
  MapRegionId,
  MapSettingsState,
} from "@/components/home/mock-data";
import type { LightningStrike } from "@/lib/weather/lightning";
import type { DisplayFeature } from "@/lib/forecast/types";
import type {
  BomRadarProduct,
  BomRadarRangeKm,
  RadarViewMode,
} from "@/lib/weather/bom-radar-types";
import type { WeatherFrame } from "@/lib/weather/maps";
import type { StormCell } from "@/lib/weather/storm-cell-types";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import type { WeatherStation } from "@/lib/weather/stations";

const HomeMap = dynamic(
  () => import("@/components/home/home-map").then((m) => m.HomeMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[360px] w-full items-center justify-center border border-white/30 bg-white/10 text-sm text-white">
        Loading map…
      </div>
    ),
  },
);

export function HomeMapDynamic({
  mode,
  regionId,
  showRadarOverlay,
  radarMode,
  radarSiteCode,
  radarRangeKm,
  radarProduct,
  frameTileUrl,
  frameImageUrl,
  frameImageFallbackUrl,
  frameImageBounds,
  frameKey,
  frameOpacity,
  frameAlt,
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
  showStations,
  stations,
  mapSatelliteImageUrl,
  mapSatelliteImageBounds,
  radarLoopFrames,
  radarFrameIndex,
  riskImageUrl,
  riskImageBounds,
  riskImageDisplay,
  riskImageOpacity,
  riskFeatures,
  onMapClick,
  probePoint,
  probePointB,
  showTransectLine,
  stormCells,
  showStormCells,
  selectedStormCellId,
  focusStormCellId,
  onSelectStormCell,
}: {
  mode: MapMode;
  regionId?: MapRegionId;
  showRadarOverlay?: boolean;
  radarMode?: RadarViewMode;
  radarSiteCode?: string | null;
  radarRangeKm?: BomRadarRangeKm;
  radarProduct?: BomRadarProduct;
  frameTileUrl?: string | null;
  frameImageUrl?: string | null;
  frameImageFallbackUrl?: string | null;
  frameImageBounds?: [[number, number], [number, number]] | null;
  frameKey?: string | number;
  frameOpacity?: number;
  frameAlt?: string;
  mapSettings: MapSettingsState;
  showLightning?: boolean;
  lightningStrikes?: LightningStrike[];
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
  showStations?: boolean;
  stations?: WeatherStation[];
  mapSatelliteImageUrl?: string | null;
  mapSatelliteImageBounds?: [[number, number], [number, number]] | null;
  radarLoopFrames?: WeatherFrame[];
  radarFrameIndex?: number;
  riskImageUrl?: string | null;
  riskImageBounds?: [[number, number], [number, number]] | null;
  riskImageDisplay?: "sheet" | "geo";
  riskImageOpacity?: number;
  riskFeatures?: DisplayFeature[];
  onMapClick?: (ll: { lat: number; lng: number }) => void;
  probePoint?: {
    lat: number;
    lng: number;
    label?: string | null;
  } | null;
  probePointB?: {
    lat: number;
    lng: number;
    label?: string | null;
  } | null;
  showTransectLine?: boolean;
  stormCells?: StormCell[];
  showStormCells?: boolean;
  selectedStormCellId?: string | null;
  focusStormCellId?: string | null;
  onSelectStormCell?: (id: string | null) => void;
}) {
  return (
    <HomeMap
      mode={mode}
      regionId={regionId}
      showRadarOverlay={showRadarOverlay}
      radarMode={radarMode}
      radarSiteCode={radarSiteCode}
      radarRangeKm={radarRangeKm}
      radarProduct={radarProduct}
      frameTileUrl={frameTileUrl}
      frameImageUrl={frameImageUrl}
      frameImageFallbackUrl={frameImageFallbackUrl}
      frameImageBounds={frameImageBounds}
      frameKey={frameKey}
      frameOpacity={frameOpacity}
      frameAlt={frameAlt}
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
      showStations={showStations}
      stations={stations}
      mapSatelliteImageUrl={mapSatelliteImageUrl}
      mapSatelliteImageBounds={mapSatelliteImageBounds}
      radarLoopFrames={radarLoopFrames}
      radarFrameIndex={radarFrameIndex}
      riskImageUrl={riskImageUrl}
      riskImageBounds={riskImageBounds}
      riskImageDisplay={riskImageDisplay}
      riskImageOpacity={riskImageOpacity}
      riskFeatures={riskFeatures}
      onMapClick={onMapClick}
      probePoint={probePoint}
      probePointB={probePointB}
      showTransectLine={showTransectLine}
      stormCells={stormCells}
      showStormCells={showStormCells}
      selectedStormCellId={selectedStormCellId}
      focusStormCellId={focusStormCellId}
      onSelectStormCell={onSelectStormCell}
    />
  );
}
