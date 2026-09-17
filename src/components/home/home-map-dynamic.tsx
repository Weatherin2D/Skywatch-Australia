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
  legend,
  mapSettings,
  showLightning,
  lightningStrikes,
  lightningAttribution,
  lightningStatus,
  lightningLive,
  lightningReferenceTime,
  lightningFrameSynced,
  showSynoptic,
  synopticFrames,
  synopticGeoJson,
  synopticValidTime,
  synopticAttribution,
  synopticLoading,
  synopticError,
  synopticReferenceTime,
  synopticFrameSynced,
}: {
  mode: MapMode;
  showRadarOverlay?: boolean;
  frameTileUrl?: string | null;
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
  lightningReferenceTime?: number | null;
  lightningFrameSynced?: boolean;
  showSynoptic?: boolean;
  synopticFrames?: SynopticFrame[];
  synopticGeoJson?: SynopticGeoJson | null;
  synopticValidTime?: number | null;
  synopticAttribution?: string | null;
  synopticLoading?: boolean;
  synopticError?: string | null;
  synopticReferenceTime?: number | null;
  synopticFrameSynced?: boolean;
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
      legend={legend}
      mapSettings={mapSettings}
      showLightning={showLightning}
      lightningStrikes={lightningStrikes}
      lightningAttribution={lightningAttribution}
      lightningStatus={lightningStatus}
      lightningLive={lightningLive}
      lightningReferenceTime={lightningReferenceTime}
      lightningFrameSynced={lightningFrameSynced}
      showSynoptic={showSynoptic}
      synopticFrames={synopticFrames}
      synopticGeoJson={synopticGeoJson}
      synopticValidTime={synopticValidTime}
      synopticAttribution={synopticAttribution}
      synopticLoading={synopticLoading}
      synopticError={synopticError}
      synopticReferenceTime={synopticReferenceTime}
      synopticFrameSynced={synopticFrameSynced}
    />
  );
}
