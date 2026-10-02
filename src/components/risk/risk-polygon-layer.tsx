"use client";

import { useEffect, useMemo } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import type { PathOptions } from "leaflet";
import L from "leaflet";
import type { DisplayFeature } from "@/lib/forecast/types";
import { styleForBomRiskLabel } from "@/lib/weather/bom-thunderstorm";

type Props = {
  features: DisplayFeature[];
  /** When true, fit the map to feature bounds once features arrive. */
  fit?: boolean;
};

function pathStyle(feature: DisplayFeature): PathOptions {
  const bom = styleForBomRiskLabel(feature.title) ?? feature.style;
  return {
    color: bom.strokeColor || "#1a1a1a",
    weight: 1,
    opacity: 0.35,
    fillColor: bom.fillColor || "#64748b",
    fillOpacity: bom.fillOpacity ?? 0.58,
    lineJoin: "round",
    lineCap: "round",
  };
}

/**
 * GeoJSON convective risk polygons for HomeMap (Map mode).
 * Styles are forced to the BoM 4-level colour key when labels match.
 */
export function RiskPolygonLayer({ features, fit = false }: Props) {
  const map = useMap();

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: features.map((f) => ({
        type: "Feature" as const,
        id: f.id,
        geometry: f.geometry,
        properties: {
          title: f.title,
          categoryId: f.categoryId,
          order: f.order,
          style: styleForBomRiskLabel(f.title) ?? f.style,
        },
      })),
    }),
    [features],
  );

  useEffect(() => {
    if (!fit || features.length === 0) return;
    const layer = L.geoJSON(geojson as GeoJSON.FeatureCollection);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.12), { animate: true, maxZoom: 7 });
    }
  }, [fit, features, geojson, map]);

  if (features.length === 0) return null;

  return (
    <GeoJSON
      key={features.map((f) => f.id).join("|")}
      data={geojson as GeoJSON.FeatureCollection}
      style={(feat) => {
        const title = String(feat?.properties?.title ?? "");
        const style = feat?.properties?.style;
        const match: DisplayFeature = {
          id: String(feat?.id ?? title),
          geometry: feat?.geometry as DisplayFeature["geometry"],
          title,
          categoryId: String(feat?.properties?.categoryId ?? ""),
          order: Number(feat?.properties?.order ?? 0),
          style: style ?? featureFallbackStyle(),
        };
        return pathStyle(match);
      }}
      onEachFeature={(feat, layer) => {
        const title = String(feat.properties?.title ?? "");
        if (title) layer.bindTooltip(title, { sticky: true });
      }}
    />
  );
}

function featureFallbackStyle() {
  return {
    fillColor: "#64748b",
    fillOpacity: 0.5,
    strokeColor: "#111827",
    strokeOpacity: 1,
    strokeWidth: 1.5,
    hatch: "none",
  };
}
