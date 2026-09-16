"use client";

import { useEffect, useState } from "react";
import type { MapSettingsState } from "@/components/home/mock-data";
import { GIBS_AU_BOUNDS } from "@/lib/weather/maps";

type Ring = [number, number][];
type GeoJson = {
  type: string;
  features?: Array<{
    type: string;
    properties?: Record<string, string>;
    geometry?: {
      type: string;
      coordinates: unknown;
    };
  }>;
  geometry?: {
    type: string;
    coordinates: unknown;
  };
};

function lonLatToPct(lon: number, lat: number) {
  const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
  return {
    x: ((lon - west) / (east - west)) * 100,
    y: ((north - lat) / (north - south)) * 100,
  };
}

function ringsFromGeometry(geometry: {
  type: string;
  coordinates: unknown;
}): Ring[] {
  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates as Ring[];
    return coords[0] ? [coords[0]] : [];
  }
  if (geometry.type === "MultiPolygon") {
    const coords = geometry.coordinates as Ring[][];
    return coords.map((poly) => poly[0]).filter(Boolean) as Ring[];
  }
  return [];
}

function ringToPath(ring: Ring): string {
  return (
    ring
      .map(([lon, lat], i) => {
        const { x, y } = lonLatToPct(lon, lat);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ") + " Z"
  );
}

function useGeoJson(url: string, enabled: boolean) {
  const [data, setData] = useState<GeoJson | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch(url)
      .then((r) => r.json())
      .then((json: GeoJson) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);
  return data;
}

/**
 * SVG annotations projected into the fixed Himawari Australia frame.
 */
export function SatelliteMapAnnotations({
  settings,
  cities,
}: {
  settings: MapSettingsState;
  cities: { name: string; lat: number; lon: number }[];
}) {
  const outline = useGeoJson(
    "/geo/australia-outline.geojson",
    settings.outlines,
  );
  const states = useGeoJson(
    "/geo/australia-states.geojson",
    settings.stateOutlines,
  );
  const stateLabels = useGeoJson(
    "/geo/australia-state-labels.geojson",
    settings.stateLabels,
  );
  const oceans = useGeoJson("/geo/ocean-labels.geojson", settings.oceanNames);

  const outlinePaths: string[] = [];
  if (outline) {
    const geoms = outline.features?.length
      ? outline.features.map((f) => f.geometry).filter(Boolean)
      : outline.geometry
        ? [outline.geometry]
        : [];
    for (const g of geoms) {
      if (!g) continue;
      for (const ring of ringsFromGeometry(g)) {
        outlinePaths.push(ringToPath(ring));
      }
    }
  }

  const statePaths: string[] = [];
  if (states?.features) {
    for (const feat of states.features) {
      if (!feat.geometry) continue;
      for (const ring of ringsFromGeometry(feat.geometry)) {
        statePaths.push(ringToPath(ring));
      }
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        {settings.stateOutlines
          ? statePaths.map((d, i) => (
              <path
                key={`state-${i}`}
                d={d}
                fill="none"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={0.18}
                vectorEffect="non-scaling-stroke"
              />
            ))
          : null}
        {settings.outlines
          ? outlinePaths.map((d, i) => (
              <path
                key={`outline-${i}`}
                d={d}
                fill="none"
                stroke="#ffffff"
                strokeWidth={0.45}
                vectorEffect="non-scaling-stroke"
              />
            ))
          : null}
      </svg>

      {settings.stateLabels && stateLabels?.features
        ? stateLabels.features.map((feat) => {
            const coords = feat.geometry?.coordinates as
              | [number, number]
              | undefined;
            if (!coords) return null;
            const { x, y } = lonLatToPct(coords[0], coords[1]);
            return (
              <span
                key={feat.properties?.code ?? feat.properties?.name}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-[10px] font-bold tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:text-[11px]"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                {feat.properties?.code ?? feat.properties?.name}
              </span>
            );
          })
        : null}

      {settings.oceanNames && oceans?.features
        ? oceans.features.map((feat) => {
            const coords = feat.geometry?.coordinates as
              | [number, number]
              | undefined;
            if (!coords) return null;
            const { x, y } = lonLatToPct(coords[0], coords[1]);
            return (
              <span
                key={feat.properties?.name}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-[9px] font-semibold tracking-[0.08em] text-sky-100/90 italic drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] sm:text-[10px]"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                {feat.properties?.name}
              </span>
            );
          })
        : null}

      {cities.map((city) => {
        const { x, y } = lonLatToPct(city.lon, city.lat);
        return (
          <span
            key={city.name}
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span className="h-2 w-2 rounded-full border border-white bg-[var(--bom-yellow)]" />
            {settings.cityLabels ? (
              <span className="mt-0.5 whitespace-nowrap text-[9px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:text-[10px]">
                {city.name}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
