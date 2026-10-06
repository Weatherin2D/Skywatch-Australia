"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageOverlay, useMap } from "react-leaflet";
import type {
  BomRadarRangeKm,
  RadarViewMode,
} from "@/lib/weather/bom-radar-types";

export type { RadarViewMode };

type SiteFrame = {
  code: string;
  name: string;
  productId: string;
  imageUrl: string;
  bounds: [[number, number], [number, number]];
};

const POLL_MS = 60_000;

/**
 * High-res BoM IDR site overlay (~125 m at 64 km) for Site mode.
 * Chrome-masked rain only; crisp pixel rendering via CSS.
 */
export function BomSiteRadarLayer({
  mode,
  siteCode,
  rangeKm,
}: {
  mode: RadarViewMode;
  siteCode: string | null;
  rangeKm: BomRadarRangeKm;
}) {
  const map = useMap();
  const [frame, setFrame] = useState<SiteFrame | null>(null);

  const query = useMemo(() => {
    if (mode !== "site" || !siteCode) return null;
    return `/api/weather/bom-site-radar?code=${encodeURIComponent(siteCode)}&range=${rangeKm}`;
  }, [mode, siteCode, rangeKm]);

  useEffect(() => {
    if (!query) {
      setFrame(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(query, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as SiteFrame;
        if (cancelled) return;
        setFrame(data);
        try {
          map.fitBounds(data.bounds, {
            animate: true,
            padding: [24, 24],
            maxZoom: 11,
          });
        } catch {
          /* map may be tearing down */
        }
      } catch {
        if (!cancelled) setFrame(null);
      }
    };

    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [query, map]);

  if (mode !== "site" || !frame) return null;

  return (
    <ImageOverlay
      key={`${frame.productId}-${frame.imageUrl}`}
      url={frame.imageUrl}
      bounds={frame.bounds}
      opacity={0.96}
      zIndex={460}
      className="skywatch-bom-site-radar"
    />
  );
}
