"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapSettingsState } from "@/components/home/mock-data";
import {
  AU_TOWNS,
  declutterTowns,
  townDensityForBounds,
  townOpacityByPopulationRank,
} from "@/lib/weather/au-towns";
import { lonLatToBoundsPct, type LonLatBounds } from "@/lib/weather/maps";

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

function ringToPath(ring: Ring, bounds?: LonLatBounds): string {
  return (
    ring
      .map(([lon, lat], i) => {
        const { x, y } = lonLatToBoundsPct(lon, lat, bounds);
        // Keep sub-pixel precision so high-res coast rings stay sharp when projected
        return `${i === 0 ? "M" : "L"}${x.toFixed(4)} ${y.toFixed(4)}`;
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
  bounds,
}: {
  settings: MapSettingsState;
  cities: { name: string; lat: number; lon: number }[];
  bounds?: LonLatBounds;
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

  const visibleTowns = useMemo(() => {
    if (!settings.townLabels) return [];
    const density = townDensityForBounds(
      bounds ?? [
        [-48, 108],
        [-8, 160],
      ],
    );
    const inFrame = AU_TOWNS.filter((town) => {
      const pct = lonLatToBoundsPct(town.lon, town.lat, bounds);
      return pct.x >= -2 && pct.x <= 102 && pct.y >= -2 && pct.y <= 102;
    });
    return declutterTowns(inFrame, density);
  }, [settings.townLabels, bounds]);

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
        outlinePaths.push(ringToPath(ring, bounds));
      }
    }
  }

  const statePaths: string[] = [];
  if (states?.features) {
    for (const feat of states.features) {
      if (!feat.geometry) continue;
      for (const ring of ringsFromGeometry(feat.geometry)) {
        statePaths.push(ringToPath(ring, bounds));
      }
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        shapeRendering="geometricPrecision"
        aria-hidden
      >
        {settings.stateOutlines
          ? statePaths.map((d, i) => (
              <path
                key={`state-${i}`}
                d={d}
                fill="none"
                stroke="rgba(255,255,255,0.7)"
                strokeWidth={1.25}
                strokeLinejoin="round"
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
                strokeWidth={2.1}
                strokeLinejoin="round"
                strokeLinecap="round"
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
            const { x, y } = lonLatToBoundsPct(coords[0], coords[1], bounds);
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
            const { x, y } = lonLatToBoundsPct(coords[0], coords[1], bounds);
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

      {settings.townLabels
        ? visibleTowns.map((town) => {
            const { x, y } = lonLatToBoundsPct(town.lon, town.lat, bounds);
            const opacity = townOpacityByPopulationRank(
              town.population,
              visibleTowns,
            );
            return (
              <span
                key={`town-${town.name}-${town.lat}`}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[8px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] transition-opacity duration-300 sm:text-[9px]"
                style={{ left: `${x}%`, top: `${y}%`, opacity }}
              >
                {town.name}
              </span>
            );
          })
        : cities.map((city) => {
            const { x, y } = lonLatToBoundsPct(city.lon, city.lat, bounds);
            return (
              <span
                key={city.name}
                className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <span className="h-2 w-2 rounded-full border border-white bg-[var(--cyan)]" />
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
