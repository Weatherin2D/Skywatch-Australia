"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import {
  STATION_MODEL_SIZE,
  drawStationModel,
  stationModelDataUrl,
} from "@/lib/weather/station-model-draw";
import {
  declutterStations,
  densityForBounds,
  densityForLeafletZoom,
  type WeatherStation,
} from "@/lib/weather/stations";
import { lonLatToBoundsPct, type LonLatBounds } from "@/lib/weather/maps";

function stationIcon(
  station: WeatherStation,
  scale: number,
  colorCoded: boolean,
): L.DivIcon {
  const url = stationModelDataUrl(station, { colorCoded });
  const size = Math.round(STATION_MODEL_SIZE * scale);
  return L.divIcon({
    className: "skywatch-station-model",
    html: `<img src="${url}" width="${size}" height="${size}" alt="${station.name.replace(/"/g, "")}" draggable="false" />`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
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

/** Leaflet map — station-model markers with zoom declutter. */
export function LeafletStationOverlay({
  stations,
  enabled,
  colorCoded = false,
}: {
  stations: WeatherStation[];
  enabled: boolean;
  colorCoded?: boolean;
}) {
  const zoom = useMapZoom();
  const density = useMemo(() => densityForLeafletZoom(zoom), [zoom]);
  const visibleStations = useMemo(
    () => (enabled ? declutterStations(stations, density) : []),
    [stations, density, enabled],
  );

  const icons = useMemo(() => {
    return visibleStations.map((s) => ({
      station: s,
      icon: stationIcon(s, density.scale, colorCoded),
    }));
  }, [visibleStations, density.scale, colorCoded]);

  if (!enabled || icons.length === 0) return null;

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
  colorCoded = false,
}: {
  stations: WeatherStation[];
  enabled: boolean;
  bounds: LonLatBounds;
  colorCoded?: boolean;
}) {
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const density = useMemo(() => densityForBounds(bounds), [bounds]);
  const visibleStations = useMemo(() => {
    if (!enabled) return [];
    const inFrame = stations.filter((station) => {
      const pct = lonLatToBoundsPct(station.lon, station.lat, bounds);
      return pct.x >= -5 && pct.x <= 105 && pct.y >= -5 && pct.y <= 105;
    });
    return declutterStations(inFrame, density);
  }, [stations, enabled, bounds, density]);

  useEffect(() => {
    if (!enabled) return;
    for (const station of visibleStations) {
      const canvas = canvasRefs.current.get(station.id);
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      drawStationModel(ctx, station, { colorCoded });
    }
  }, [visibleStations, enabled, colorCoded]);

  if (!enabled || visibleStations.length === 0) return null;

  const size = Math.round(STATION_MODEL_SIZE * density.scale);

  return (
    <div className="pointer-events-none absolute inset-0 z-[25]">
      {visibleStations.map((station) => {
        const pct = lonLatToBoundsPct(station.lon, station.lat, bounds);
        return (
          <canvas
            key={`${station.id}-${colorCoded ? "c" : "w"}`}
            width={STATION_MODEL_SIZE}
            height={STATION_MODEL_SIZE}
            ref={(el) => {
              if (el) {
                canvasRefs.current.set(station.id, el);
                const ctx = el.getContext("2d");
                if (ctx) drawStationModel(ctx, station, { colorCoded });
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
              width: size,
              height: size,
            }}
          />
        );
      })}
    </div>
  );
}
