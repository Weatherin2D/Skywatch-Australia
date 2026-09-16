"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import { Layers, LocateFixed } from "lucide-react";
import { CITY_MARKERS, type MapMode } from "@/components/home/mock-data";
import { cn } from "@/lib/utils";
import "leaflet/dist/leaflet.css";

type Props = {
  mode: MapMode;
};

function MapModeEffect({ mode }: { mode: MapMode }) {
  const map = useMap();
  useEffect(() => {
    // Placeholder for future overlay switching by mode
    map.getContainer().dataset.mapMode = mode;
  }, [map, mode]);
  return null;
}

function MapTools() {
  const map = useMap();
  return (
    <div className="absolute left-3 top-14 z-[1000] flex flex-col gap-2">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--navy-deep)]/95 text-white shadow-lg transition hover:border-[var(--sky)] hover:text-[var(--sky)]"
        aria-label="Recentre on Australia"
        onClick={() => map.setView([-25.5, 134.5], 4, { animate: true })}
      >
        <LocateFixed className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--navy-deep)]/95 text-white shadow-lg transition hover:border-[var(--sky)] hover:text-[var(--sky)]"
        aria-label="Layer stack"
        onClick={() => undefined}
      >
        <Layers className="h-4 w-4" />
      </button>
    </div>
  );
}

function DemoRadarBlobs() {
  const cells = [
    { lat: -28.2, lon: 152.8, r: 90000, color: "#22c55e" },
    { lat: -29.1, lon: 151.9, r: 70000, color: "#eab308" },
    { lat: -30.4, lon: 150.6, r: 55000, color: "#ef4444" },
    { lat: -32.6, lon: 151.2, r: 80000, color: "#84cc16" },
    { lat: -33.5, lon: 150.4, r: 45000, color: "#f59e0b" },
    { lat: -26.8, lon: 152.1, r: 60000, color: "#22c55e" },
  ];
  return (
    <>
      {cells.map((cell, i) => (
        <CircleMarker
          key={i}
          center={[cell.lat, cell.lon]}
          radius={18 + (i % 3) * 6}
          pathOptions={{
            color: cell.color,
            fillColor: cell.color,
            fillOpacity: 0.35,
            weight: 1,
            opacity: 0.7,
          }}
        />
      ))}
    </>
  );
}

export function HomeMap({ mode }: Props) {
  const satellite = mode === "Satellite";

  return (
    <div className="skywatch-map relative h-full min-h-[360px] w-full overflow-hidden rounded-lg border border-[var(--border)]">
      <MapContainer
        center={[-25.5, 134.5]}
        zoom={4}
        className="h-full w-full"
        scrollWheelZoom
        zoomControl
        attributionControl
      >
        <TileLayer
          key={satellite ? "sat" : "map"}
          url={
            satellite
              ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          }
          attribution={
            satellite
              ? "Tiles &copy; Esri"
              : '&copy; <a href="https://carto.com/" target="_blank" rel="noreferrer">CARTO</a>'
          }
          maxZoom={18}
        />
        <MapModeEffect mode={mode} />
        <MapTools />
        {(mode === "Radar" || mode === "Map" || mode === "Rainfall") && (
          <DemoRadarBlobs />
        )}
        {CITY_MARKERS.map((city) => (
          <CircleMarker
            key={city.name}
            center={[city.lat, city.lon]}
            radius={4}
            pathOptions={{
              color: "#fff",
              fillColor: "#00aeef",
              fillOpacity: 1,
              weight: 1,
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -6]}
              opacity={0.95}
              permanent={false}
            >
              {city.name}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] rounded-md border border-[var(--border)] bg-[var(--navy-deep)]/90 px-3 py-2">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Intensity
        </p>
        <div className="flex h-2 w-36 overflow-hidden rounded-full">
          <span className="flex-1 bg-emerald-400" />
          <span className="flex-1 bg-lime-400" />
          <span className="flex-1 bg-yellow-400" />
          <span className="flex-1 bg-orange-400" />
          <span className="flex-1 bg-red-500" />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-[var(--muted-foreground)]">
          <span>Light</span>
          <span>Heavy</span>
        </div>
      </div>

      <div
        className={cn(
          "pointer-events-none absolute left-3 top-3 z-[1000] rounded-md border border-[var(--border)] bg-[var(--navy-deep)]/90 px-2.5 py-1 text-xs text-[var(--muted-foreground)]",
        )}
      >
        Mode: <span className="text-white">{mode}</span>
      </div>
    </div>
  );
}
