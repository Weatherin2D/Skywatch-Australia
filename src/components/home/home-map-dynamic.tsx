"use client";

import dynamic from "next/dynamic";
import type { MapMode } from "@/components/home/mock-data";

const HomeMap = dynamic(
  () => import("@/components/home/home-map").then((m) => m.HomeMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[360px] w-full items-center justify-center border border-[var(--bom-blue)] bg-[var(--bom-blue)]/10 text-sm text-[var(--bom-blue)]">
        Loading map…
      </div>
    ),
  },
);

export function HomeMapDynamic({
  mode,
  showRadarOverlay,
}: {
  mode: MapMode;
  showRadarOverlay?: boolean;
}) {
  return <HomeMap mode={mode} showRadarOverlay={showRadarOverlay} />;
}
