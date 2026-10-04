"use client";

import dynamic from "next/dynamic";
import type { SoundingMapPlace } from "@/components/soundings/sounding-location-map";

const SoundingLocationMap = dynamic(
  () =>
    import("@/components/soundings/sounding-location-map").then(
      (m) => m.SoundingLocationMap,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[min(42vh,420px)] min-h-[260px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-white/55">
        Loading map…
      </div>
    ),
  },
);

export function SoundingLocationMapDynamic({
  place,
  onPick,
  className,
}: {
  place: SoundingMapPlace;
  onPick: (place: SoundingMapPlace) => void;
  className?: string;
}) {
  return (
    <SoundingLocationMap place={place} onPick={onPick} className={className} />
  );
}
