"use client";

import dynamic from "next/dynamic";
import type { MapMode } from "@/components/home/mock-data";

const HomeMap = dynamic(
  () => import("@/components/home/home-map").then((m) => m.HomeMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[360px] w-full items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)] text-sm text-[var(--muted-foreground)]">
        Loading map…
      </div>
    ),
  },
);

export function HomeMapDynamic({ mode }: { mode: MapMode }) {
  return <HomeMap mode={mode} />;
}
