"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import { LocateFixed } from "lucide-react";
import { CITY_MARKERS, type MapMode } from "@/components/home/mock-data";
import "leaflet/dist/leaflet.css";

type Props = {
  mode: MapMode;
  showRadarOverlay?: boolean;
  /** Leaflet tile URL template for the active weather frame */
  frameTileUrl?: string | null;
  frameKey?: string | number;
  frameOpacity?: number;
  legend?: "radar" | "satellite" | null;
};

function MapModeEffect({ mode }: { mode: MapMode }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().dataset.mapMode = mode;
  }, [map, mode]);
  return null;
}

function MapTools() {
  const map = useMap();
  return (
    <div className="absolute left-3 top-3 z-[1000] flex flex-col gap-2">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center border border-white/30 bg-[var(--bom-blue)] text-white shadow transition hover:bg-[var(--bom-blue-mid)] hover:text-[var(--bom-yellow)]"
        aria-label="Recentre on Australia"
        onClick={() => map.setView([-25.5, 134.5], 4, { animate: true })}
      >
        <LocateFixed className="h-4 w-4" />
      </button>
    </div>
  );
}

function DemoRadarBlobs() {
  const cells = [
    { lat: -28.2, lon: 152.8, color: "#22c55e" },
    { lat: -29.1, lon: 151.9, color: "#eab308" },
    { lat: -30.4, lon: 150.6, color: "#ef4444" },
    { lat: -32.6, lon: 151.2, color: "#84cc16" },
    { lat: -33.5, lon: 150.4, color: "#f59e0b" },
    { lat: -26.8, lon: 152.1, color: "#22c55e" },
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

export function HomeMap({
  mode,
  showRadarOverlay = false,
  frameTileUrl = null,
  frameKey,
  frameOpacity = 0.85,
  legend = null,
}: Props) {
  const satelliteLoop = mode === "Satellite";
  // Satellite IR loop: dark gray basemap + weather tiles (not static Esri imagery)
  const basemapUrl = satelliteLoop
    ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
    : mode === "Radar"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";

  // Keep classic imagery only when Satellite is selected but no IR frame yet
  const useEsriImagery = mode === "Satellite" && !frameTileUrl;

  return (
    <div className="skywatch-map relative h-full min-h-[360px] w-full overflow-hidden">
      <MapContainer
        center={[-25.5, 134.5]}
        zoom={4}
        className="h-full w-full"
        scrollWheelZoom
        zoomControl
        attributionControl
        maxZoom={16}
      >
        <TileLayer
          key={useEsriImagery ? "sat-esri" : "base"}
          url={
            useEsriImagery
              ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              : basemapUrl
          }
          attribution="Tiles &copy; Esri"
          maxZoom={16}
        />
        {frameTileUrl ? (
          <TileLayer
            key={`wx-${frameKey ?? frameTileUrl}`}
            url={frameTileUrl}
            opacity={frameOpacity}
            maxZoom={satelliteLoop ? 6 : 12}
            maxNativeZoom={satelliteLoop ? 6 : 12}
            attribution={
              satelliteLoop
                ? 'Infrared &copy; <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> / RainViewer'
                : "Radar &copy; RainViewer"
            }
          />
        ) : null}
        <MapModeEffect mode={mode} />
        <MapTools />
        {showRadarOverlay && mode === "Radar" ? <DemoRadarBlobs /> : null}
        {CITY_MARKERS.map((city) => (
          <CircleMarker
            key={city.name}
            center={[city.lat, city.lon]}
            radius={4}
            pathOptions={{
              color: "#fff",
              fillColor: "#ffe000",
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

      {legend === "radar" || (showRadarOverlay && mode === "Radar") ? (
        <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] border border-white/30 bg-[var(--bom-blue)]/90 px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-white/80">
            Radar intensity
          </p>
          <div className="flex h-2 w-36 overflow-hidden">
            <span className="flex-1 bg-emerald-400" />
            <span className="flex-1 bg-lime-400" />
            <span className="flex-1 bg-yellow-400" />
            <span className="flex-1 bg-orange-400" />
            <span className="flex-1 bg-red-500" />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-white/75">
            <span>Light</span>
            <span>Heavy</span>
          </div>
        </div>
      ) : null}

      {legend === "satellite" || (satelliteLoop && frameTileUrl) ? (
        <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] border border-white/30 bg-[var(--bom-blue)]/90 px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-white/80">
            Infrared · clouds
          </p>
          <div className="flex h-2 w-36 overflow-hidden">
            <span className="flex-1 bg-[#1a1a2e]" />
            <span className="flex-1 bg-[#4a5568]" />
            <span className="flex-1 bg-[#a0aec0]" />
            <span className="flex-1 bg-[#e2e8f0]" />
            <span className="flex-1 bg-white" />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-white/75">
            <span>Warm / clear</span>
            <span>Cold cloud tops</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
