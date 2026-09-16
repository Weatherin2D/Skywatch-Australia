"use client";

import dynamic from "next/dynamic";
import type {
  MapMode,
  MapSettingsState,
} from "@/components/home/mock-data";

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
    />
  );
}
