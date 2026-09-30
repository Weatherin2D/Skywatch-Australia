"use client";

import dynamic from "next/dynamic";
import type {
  MapMode,
  MapSettingsState,
} from "@/components/home/mock-data";
import type { LightningStrike } from "@/lib/weather/lightning";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";

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
  showRadarOverlay,
  frameTileUrl,
  frameImageUrl,
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
}: {
  mode: MapMode;
  showRadarOverlay?: boolean;
  frameTileUrl?: string | null;
  frameImageUrl?: string | null;
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
}) {
  return (
    <HomeMap
      mode={mode}
      showRadarOverlay={showRadarOverlay}
      frameTileUrl={frameTileUrl}
      frameImageUrl={frameImageUrl}
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
    />
  );
}
