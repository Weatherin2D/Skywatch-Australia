"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import {
  findBomRadarSite,
  siteRadarBounds,
  type BomRadarRangeKm,
  type RadarViewMode,
} from "@/lib/weather/bom-radar-types";

export type { RadarViewMode };

/**
 * Site mode framing only — zooms the map to a radar's coverage box.
 * Imagery always comes from BoM WMTS tiles (SmoothRadarLayer).
 */
export function BomRadarSiteFocus({
  mode,
  siteCode,
  rangeKm,
}: {
  mode: RadarViewMode;
  siteCode: string | null;
  rangeKm: BomRadarRangeKm;
}) {
  const map = useMap();

  useEffect(() => {
    if (mode !== "site" || !siteCode) return;
    const site = findBomRadarSite(siteCode);
    if (!site) return;
    const bounds = siteRadarBounds(site, rangeKm);
    try {
      map.fitBounds(bounds, { animate: true, padding: [24, 24], maxZoom: 10 });
    } catch {
      /* map may be tearing down */
    }
  }, [mode, siteCode, rangeKm, map]);

  return null;
}
