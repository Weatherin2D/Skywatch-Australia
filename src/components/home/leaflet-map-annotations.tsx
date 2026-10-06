"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJSON, Marker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { MapSettingsState } from "@/components/home/mock-data";
import { CITY_MARKERS } from "@/components/home/mock-data";
import {
  AU_TOWNS,
  declutterTowns,
  townDensityForLeafletZoom,
} from "@/lib/weather/au-towns";

type GeoJsonObject = GeoJSON.GeoJsonObject;

function useGeoJson(url: string, enabled: boolean) {
  const [data, setData] = useState<GeoJsonObject | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch(url)
      .then((r) => r.json())
      .then((json: GeoJsonObject) => {
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

function useMapZoom() {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    zoom: () => setZoom(map.getZoom()),
  });
  return zoom;
}

const labelIcon = (text: string, kind: "state" | "ocean" | "city" | "town") =>
  L.divIcon({
    className: "skywatch-map-label",
    html: `<span class="skywatch-map-label__text skywatch-map-label__text--${kind}">${text}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

const cityDot = L.divIcon({
  className: "skywatch-city-dot",
  html: `<span class="skywatch-city-dot__mark"></span>`,
  iconSize: [8, 8],
  iconAnchor: [4, 4],
});

const townDot = L.divIcon({
  className: "skywatch-city-dot skywatch-city-dot--town",
  html: `<span class="skywatch-city-dot__mark skywatch-city-dot__mark--town"></span>`,
  iconSize: [6, 6],
  iconAnchor: [3, 3],
});

/** Leaflet annotation layers for Map / Radar views. */
export function LeafletMapAnnotations({
  settings,
}: {
  settings: MapSettingsState;
}) {
  const zoom = useMapZoom();
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
    return declutterTowns(AU_TOWNS, townDensityForLeafletZoom(zoom));
  }, [settings.townLabels, zoom]);

  return (
    <>
      {settings.stateOutlines && states ? (
        <GeoJSON
          key="state-outlines"
          data={states}
          style={{
            color: "#ffffff",
            weight: 1,
            opacity: 0.55,
            fillOpacity: 0,
          }}
        />
      ) : null}
      {settings.outlines && outline ? (
        <GeoJSON
          key="au-outline"
          data={outline}
          style={{
            color: "#ffffff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0,
          }}
        />
      ) : null}

      {settings.stateLabels &&
      stateLabels &&
      "features" in stateLabels &&
      Array.isArray(stateLabels.features)
        ? stateLabels.features.map((feat, i) => {
            const f = feat as GeoJSON.Feature;
            if (f.geometry?.type !== "Point") return null;
            const [lon, lat] = f.geometry.coordinates as [number, number];
            const code =
              (f.properties as { code?: string; name?: string } | null)?.code ??
              (f.properties as { name?: string } | null)?.name ??
              "·";
            return (
              <Marker
                key={`state-label-${i}`}
                position={[lat, lon]}
                icon={labelIcon(code, "state")}
                interactive={false}
              />
            );
          })
        : null}

      {settings.oceanNames &&
      oceans &&
      "features" in oceans &&
      Array.isArray(oceans.features)
        ? oceans.features.map((feat, i) => {
            const f = feat as GeoJSON.Feature;
            if (f.geometry?.type !== "Point") return null;
            const [lon, lat] = f.geometry.coordinates as [number, number];
            const name =
              (f.properties as { name?: string } | null)?.name ?? "";
            return (
              <Marker
                key={`ocean-${i}`}
                position={[lat, lon]}
                icon={labelIcon(name, "ocean")}
                interactive={false}
              />
            );
          })
        : null}

      {/* Dense towns replace the sparse capital dots while enabled. */}
      {settings.townLabels
        ? visibleTowns.map((town) => (
            <Marker
              key={`town-${town.name}-${town.lat}`}
              position={[town.lat, town.lon]}
              icon={townDot}
              interactive={false}
              zIndexOffset={200}
            >
              <Tooltip
                permanent
                direction="right"
                offset={[5, 0]}
                className="skywatch-city-tooltip skywatch-town-tooltip"
              >
                {town.name}
              </Tooltip>
            </Marker>
          ))
        : CITY_MARKERS.map((city) => (
            <Marker
              key={city.name}
              position={[city.lat, city.lon]}
              icon={cityDot}
              interactive={false}
            >
              {settings.cityLabels ? (
                <Tooltip
                  permanent
                  direction="right"
                  offset={[6, 0]}
                  className="skywatch-city-tooltip"
                >
                  {city.name}
                </Tooltip>
              ) : null}
            </Marker>
          ))}
    </>
  );
}
