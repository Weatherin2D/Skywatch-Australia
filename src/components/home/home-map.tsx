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
import { GIBS_AU_ASPECT, GIBS_AU_BOUNDS } from "@/lib/weather/maps";
import "leaflet/dist/leaflet.css";

type Props = {
  mode: MapMode;
  showRadarOverlay?: boolean;
  /** Leaflet tile URL template for RainViewer frames */
  frameTileUrl?: string | null;
  /** Full-frame IR image (GIBS WMS) */
  frameImageUrl?: string | null;
  frameImageBounds?: [[number, number], [number, number]] | null;
  frameKey?: string | number;
  frameOpacity?: number;
  frameAlt?: string;
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
        className="flex h-9 w-9 items-center justify-center border border-[var(--brand)]/20 bg-[var(--bom-blue)] text-[var(--brand)] shadow transition hover:bg-[var(--navy-deep)] hover:text-[var(--brand)]"
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

/** Project lon/lat into % within the fixed satellite frame for city pins. */
function cityPinStyle(lat: number, lon: number) {
  const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
  const x = ((lon - west) / (east - west)) * 100;
  const y = ((north - lat) / (north - south)) * 100;
  return { left: `${x}%`, top: `${y}%` };
}

export function HomeMap({
  mode,
  showRadarOverlay = false,
  frameTileUrl = null,
  frameImageUrl = null,
  frameKey,
  frameOpacity = 1,
  frameAlt = "Satellite loop frame",
  legend = null,
}: Props) {
  const satelliteLoop = mode === "Satellite";
  const useEsriImagery = mode === "Satellite" && !frameImageUrl && !frameTileUrl;

  const basemapUrl =
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";

  // Satellite: full-bleed image, no zoom/pan, fills the border with no letterbox
  if (satelliteLoop) {
    return (
      <div
        className="skywatch-map relative w-full overflow-hidden bg-black"
        style={{ aspectRatio: String(GIBS_AU_ASPECT) }}
        data-map-mode="Satellite"
      >
        {frameImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={frameImageUrl}
            alt={frameAlt}
            className="absolute inset-0 h-full w-full object-fill select-none"
            style={{ opacity: frameOpacity }}
            draggable={false}
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a1628] text-sm text-white/70">
            Loading satellite frames…
          </div>
        )}

        {CITY_MARKERS.map((city) => (
          <span
            key={city.name}
            title={city.name}
            className="pointer-events-none absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[var(--bom-yellow)]"
            style={cityPinStyle(city.lat, city.lon)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="skywatch-map relative h-full min-h-[360px] w-full overflow-hidden">
      <MapContainer
        key="map-free"
        center={[-25.5, 134.5]}
        zoom={4}
        minZoom={3}
        maxZoom={16}
        className="h-full w-full"
        scrollWheelZoom
        doubleClickZoom
        touchZoom
        boxZoom
        keyboard
        dragging
        zoomControl
        attributionControl
        maxBounds={[
          [-55, 90],
          [5, 180],
        ]}
        maxBoundsViscosity={0.85}
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
            key={`wx-tile-${frameKey ?? frameTileUrl}`}
            url={frameTileUrl}
            opacity={frameOpacity}
            maxZoom={12}
            maxNativeZoom={10}
            errorTileUrl="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            attribution="Radar &copy; RainViewer"
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
        <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] border border-[var(--brand)]/20 bg-[var(--bom-blue)]/95 px-3 py-2 text-[var(--brand)]">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--brand)]/80">
            Radar intensity
          </p>
          <div className="flex h-2 w-36 overflow-hidden">
            <span className="flex-1 bg-emerald-400" />
            <span className="flex-1 bg-lime-400" />
            <span className="flex-1 bg-yellow-400" />
            <span className="flex-1 bg-orange-400" />
            <span className="flex-1 bg-red-500" />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-[var(--brand)]/75">
            <span>Light</span>
            <span>Heavy</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
