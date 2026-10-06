"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import {
  STATION_MODEL_SIZE,
  drawStationModel,
  stationModelDataUrl,
} from "@/lib/weather/station-model-draw";
import type { WeatherStation } from "@/lib/weather/stations";
import { lonLatToBoundsPct, type LonLatBounds } from "@/lib/weather/maps";

function stationIcon(station: WeatherStation): L.DivIcon {
  const url = stationModelDataUrl(station);
  return L.divIcon({
    className: "skywatch-station-model",
    html: `<img src="${url}" width="${STATION_MODEL_SIZE}" height="${STATION_MODEL_SIZE}" alt="${station.name.replace(/"/g, "")}" draggable="false" />`,
    iconSize: [STATION_MODEL_SIZE, STATION_MODEL_SIZE],
    iconAnchor: [STATION_MODEL_SIZE / 2, STATION_MODEL_SIZE / 2],
  });
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

/** Leaflet map — station-model markers. */
export function LeafletStationOverlay({
  stations,
  enabled,
}: {
  stations: WeatherStation[];
  enabled: boolean;
  }) {
  const zoom = useMapZoom();
  const visible = enabled && zoom >= 4;

  const icons = useMemo(() => {
    if (!visible) return [];
    return stations.map((s) => ({
      station: s,
      icon: stationIcon(s),
    }));
  }, [stations, visible]);

  if (!visible) return null;

  return (
    <>
      {icons.map(({ station, icon }) => (
        <Marker
          key={station.id}
          position={[station.lat, station.lon]}
          icon={icon}
          interactive={false}
          zIndexOffset={450}
        />
      ))}
    </>
  );
}

/** Satellite / fixed-image plane — absolute-positioned station models. */
export function SatelliteStationOverlay({
  stations,
  enabled,
  bounds,
}: {
  stations: WeatherStation[];
  enabled: boolean;
  bounds: LonLatBounds;
}) {
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    for (const station of stations) {
      const canvas = canvasRefs.current.get(station.id);
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      drawStationModel(ctx, station);
    }
  }, [stations, enabled]);

  if (!enabled || stations.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[25]">
      {stations.map((station) => {
        const pct = lonLatToBoundsPct(station.lon, station.lat, bounds);
        if (
          pct.x < -5 ||
          pct.x > 105 ||
          pct.y < -5 ||
          pct.y > 105
        ) {
          return null;
        }
        return (
          <canvas
            key={station.id}
            width={STATION_MODEL_SIZE}
            height={STATION_MODEL_SIZE}
            ref={(el) => {
              if (el) {
                canvasRefs.current.set(station.id, el);
                const ctx = el.getContext("2d");
                if (ctx) drawStationModel(ctx, station);
              } else {
                canvasRefs.current.delete(station.id);
              }
            }}
            title={`${station.name}${
              station.temperatureC != null
                ? ` · ${Math.round(station.temperatureC)}°C`
                : ""
            }`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${pct.x}%`,
              top: `${pct.y}%`,
              width: STATION_MODEL_SIZE,
              height: STATION_MODEL_SIZE,
            }}
          />
        );
      })}
    </div>
  );
}
