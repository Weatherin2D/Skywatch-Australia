"use client";

import { useEffect, useState } from "react";
import { GeoJSON, Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { MapSettingsState } from "@/components/home/mock-data";
import { CITY_MARKERS } from "@/components/home/mock-data";

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

const labelIcon = (text: string, kind: "state" | "ocean" | "city") =>
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

/** Leaflet annotation layers for Map / Radar views. */
export function LeafletMapAnnotations({
  settings,
}: {
  settings: MapSettingsState;
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

      {CITY_MARKERS.map((city) => (
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
