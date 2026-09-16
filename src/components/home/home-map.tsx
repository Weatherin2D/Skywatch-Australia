"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  ImageOverlay,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { LatLngBounds } from "leaflet";
import { LocateFixed } from "lucide-react";
import { CITY_MARKERS, type MapMode } from "@/components/home/mock-data";
import { GIBS_AU_ASPECT, GIBS_AU_BOUNDS } from "@/lib/weather/maps";
import { cn } from "@/lib/utils";
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
  legend?: "radar" | "satellite" | null;
};

function MapModeEffect({ mode }: { mode: MapMode }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().dataset.mapMode = mode;
  }, [map, mode]);
  return null;
}

/** Lock view to satellite frame bounds — no zoom/pan; image edges match map border. */
function SatelliteFrameLock({
  bounds,
  active,
}: {
  bounds: LatLngBoundsExpression;
  active: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (!active) {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      map.touchZoom.enable();
      map.options.minZoom = 3;
      map.options.maxZoom = 16;
      map.setMinZoom(3);
      map.setMaxZoom(16);
      map.setMaxBounds([
        [-55, 90],
        [5, 180],
      ]);
      return;
    }

    const latLngBounds = new LatLngBounds(
      bounds as [[number, number], [number, number]],
    );

    const lockToFrame = () => {
      map.invalidateSize({ pan: false });
      // Fractional zoom so the frame can match the container exactly
      map.options.zoomSnap = 0;
      const zoom = map.getBoundsZoom(latLngBounds, false);
      map.setMinZoom(zoom);
      map.setMaxZoom(zoom);
      map.setView(latLngBounds.getCenter(), zoom, { animate: false });
      map.setMaxBounds(latLngBounds.pad(0.001));
    };

    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    map.touchZoom.disable();

    lockToFrame();
    const t1 = window.setTimeout(lockToFrame, 0);
    const t2 = window.setTimeout(lockToFrame, 100);
    const t3 = window.setTimeout(lockToFrame, 400);

    const ro = new ResizeObserver(() => {
      lockToFrame();
    });
    ro.observe(map.getContainer());

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      ro.disconnect();
    };
  }, [map, active, bounds]);

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
  frameImageUrl = null,
  frameImageBounds = null,
  frameKey,
  frameOpacity = 0.85,
  legend = null,
}: Props) {
  const satelliteLoop = mode === "Satellite";
  const hasWeatherFrame = Boolean(frameTileUrl || frameImageUrl);
  const useEsriImagery = mode === "Satellite" && !hasWeatherFrame;
  // WMS frames share this fixed Australia bbox — lock the map to it
  const satelliteBounds = GIBS_AU_BOUNDS;

  const basemapUrl =
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";

  return (
    <div
      className={cn(
        "skywatch-map relative w-full overflow-hidden",
        satelliteLoop ? null : "h-full min-h-[360px]",
      )}
      style={
        satelliteLoop
          ? { aspectRatio: String(GIBS_AU_ASPECT) }
          : undefined
      }
    >
      <MapContainer
        key={satelliteLoop ? "sat-locked" : "map-free"}
        center={[-25.5, 134.5]}
        zoom={4}
        minZoom={satelliteLoop ? 0 : 3}
        maxZoom={satelliteLoop ? 22 : 16}
        zoomSnap={satelliteLoop ? 0 : 1}
        zoomDelta={satelliteLoop ? 0 : 1}
        className="h-full w-full !bg-[#0a1628]"
        scrollWheelZoom={!satelliteLoop}
        doubleClickZoom={!satelliteLoop}
        touchZoom={!satelliteLoop}
        boxZoom={!satelliteLoop}
        keyboard={!satelliteLoop}
        dragging={!satelliteLoop}
        zoomControl={!satelliteLoop}
        attributionControl
        {...(satelliteLoop
          ? {}
          : {
              maxBounds: [
                [-55, 90],
                [5, 180],
              ] as [[number, number], [number, number]],
              maxBoundsViscosity: 0.85,
            })}
      >
        {satelliteLoop && frameImageUrl && frameImageBounds ? null : (
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
        )}
        {frameTileUrl ? (
          <TileLayer
            key={`wx-tile-${frameKey ?? frameTileUrl}`}
            url={frameTileUrl}
            opacity={frameOpacity}
            maxZoom={12}
            maxNativeZoom={10}
            errorTileUrl="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            attribution={
              satelliteLoop
                ? 'Infrared &copy; <a href="https://www.rainviewer.com/">RainViewer</a>'
                : "Radar &copy; RainViewer"
            }
          />
        ) : null}
        {frameImageUrl && frameImageBounds ? (
          <ImageOverlay
            key={`wx-img-${frameKey ?? frameImageUrl}`}
            url={frameImageUrl}
            bounds={frameImageBounds}
            opacity={frameOpacity}
            zIndex={350}
          />
        ) : null}
        <MapModeEffect mode={mode} />
        <SatelliteFrameLock bounds={satelliteBounds} active={satelliteLoop} />
        {!satelliteLoop ? <MapTools /> : null}
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

      {legend === "satellite" || (satelliteLoop && hasWeatherFrame) ? (
        <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] border border-white/30 bg-[var(--bom-blue)]/90 px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-white/80">
            Infrared · cloud tops
          </p>
          <div className="flex h-2 w-36 overflow-hidden">
            <span className="flex-1 bg-[#1b2838]" />
            <span className="flex-1 bg-[#3d7ea6]" />
            <span className="flex-1 bg-[#c4d66a]" />
            <span className="flex-1 bg-[#e8a03c]" />
            <span className="flex-1 bg-[#c43c3c]" />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-white/75">
            <span>Clear / warm</span>
            <span>Cold tops</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
