"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";

const NAVY = "#0a1628";

/**
 * Belt-and-suspenders against Leaflet's default `#ddd` container fill.
 * CSS !important usually wins; this also sets inline styles after map create
 * so pan/zoom never flashes light-grey unloaded slabs.
 *
 * Only paints the map container — never tile-containers (radar overlays are
 * transparent and must not cover the basemap with an opaque fill).
 */
export function MapChromeFix() {
  const map = useMap();

  useEffect(() => {
    const root = map.getContainer();

    const paint = () => {
      root.style.setProperty("background", NAVY, "important");
      root.style.setProperty("background-color", NAVY, "important");
    };
    paint();
    map.on("zoomend", paint);
    map.on("moveend", paint);
    map.on("layeradd", paint);
    return () => {
      map.off("zoomend", paint);
      map.off("moveend", paint);
      map.off("layeradd", paint);
    };
  }, [map]);

  return null;
}
