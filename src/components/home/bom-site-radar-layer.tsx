"use client";

import { useEffect, useState } from "react";
import { ImageOverlay, useMap, useMapEvents } from "react-leaflet";

type SiteFrame = {
  code: string;
  name: string;
  productId: string;
  imageUrl: string;
  bounds: [[number, number], [number, number]];
};

const MIN_ZOOM = 8;
const POLL_MS = 60_000;

/**
 * Georeferenced BoM IDR site overlays — sharper than national tiles when zoomed in.
 */
export function BomSiteRadarLayer({ enabled }: { enabled: boolean }) {
  const map = useMap();
  const [sites, setSites] = useState<SiteFrame[]>([]);
  const [zoom, setZoom] = useState(() => map.getZoom());

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    moveend: () => setZoom(map.getZoom()),
  });

  useEffect(() => {
    if (!enabled || zoom < MIN_ZOOM) {
      setSites([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const c = map.getCenter();
        const res = await fetch(
          `/api/weather/bom-site-radar?lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&limit=2`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { sites?: SiteFrame[] };
        if (!cancelled) setSites(data.sites ?? []);
      } catch {
        if (!cancelled) setSites([]);
      }
    };

    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, zoom, map]);

  if (!enabled || zoom < MIN_ZOOM || sites.length === 0) return null;

  return (
    <>
      {sites.map((s) => (
        <ImageOverlay
          key={s.productId}
          url={s.imageUrl}
          bounds={s.bounds}
          opacity={0.92}
          zIndex={460}
          className="skywatch-bom-site-radar"
        />
      ))}
    </>
  );
}
