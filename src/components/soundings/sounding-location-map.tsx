"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { LocateFixed } from "lucide-react";
import { LeafletMapAnnotations } from "@/components/home/leaflet-map-annotations";
import { MapFullscreenButton } from "@/components/home/map-fullscreen";
import {
  DEFAULT_MAP_SETTINGS,
  getMapRegion,
  MAP_REGIONS,
  type MapRegionId,
  type RegionBounds,
} from "@/components/home/mock-data";
import { SOUNDING_STATIONS } from "@/lib/weather/sounding-stations";
import { cn } from "@/lib/utils";
import "leaflet/dist/leaflet.css";

const MAP_SETTINGS = {
  ...DEFAULT_MAP_SETTINGS,
  outlines: true,
  stateOutlines: true,
  cityLabels: false,
  satelliteBasemap: false,
};

function formatCoordLabel(lat: number, lon: number): string {
  const ns = lat < 0 ? "S" : "N";
  const ew = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

const pinIcon = L.divIcon({
  className: "sounding-map-pin",
  html: `<span class="sounding-map-pin__dot"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function FitRegion({
  bounds,
  regionId,
}: {
  bounds: RegionBounds;
  regionId: MapRegionId;
}) {
  const map = useMap();
  const key = `${regionId}:${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`;
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    map.fitBounds(bounds, {
      animate: true,
      padding: [24, 24],
      maxZoom: regionId === "national" ? 5.5 : 8,
    });
  }, [map, bounds, key, regionId]);

  useEffect(() => {
    const onResize = () => map.invalidateSize({ animate: false });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map]);

  return null;
}

function ClickPicker({
  onPick,
}: {
  onPick: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(
        Math.round(e.latlng.lat * 1000) / 1000,
        Math.round(e.latlng.lng * 1000) / 1000,
      );
    },
  });
  return null;
}

function RecenterButton({
  bounds,
  regionId,
}: {
  bounds: RegionBounds;
  regionId: MapRegionId;
}) {
  const map = useMap();
  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-[#0f172a]/90 text-white shadow-lg backdrop-blur-md transition hover:border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/15 hover:text-[var(--cyan)]"
      aria-label="Recentre map"
      onClick={() => {
        map.fitBounds(bounds, {
          animate: true,
          padding: [24, 24],
          maxZoom: regionId === "national" ? 5.5 : 8,
        });
      }}
    >
      <LocateFixed className="h-4 w-4" />
    </button>
  );
}

function FollowSelection({
  lat,
  lon,
}: {
  lat: number;
  lon: number;
}) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    // First paint: leave FitRegion in control so national/state framing sticks.
    if (first.current) {
      first.current = false;
      return;
    }
    const pt = L.latLng(lat, lon);
    if (!map.getBounds().pad(-0.15).contains(pt)) {
      map.panTo(pt, { animate: true });
    }
  }, [map, lat, lon]);
  return null;
}

export type SoundingMapPlace = {
  lat: number;
  lon: number;
  label: string;
};

type Props = {
  place: SoundingMapPlace;
  onPick: (place: SoundingMapPlace) => void;
  className?: string;
};

export function SoundingLocationMap({ place, onPick, className }: Props) {
  const [regionId, setRegionId] = useState<MapRegionId>("national");
  const shellRef = useRef<HTMLDivElement>(null);
  const [fullscreenTarget, setFullscreenTarget] = useState<HTMLElement | null>(
    null,
  );
  const region = getMapRegion(regionId);
  const bounds = region.bounds;

  useEffect(() => {
    setFullscreenTarget(shellRef.current);
  }, []);

  const stations = useMemo(() => SOUNDING_STATIONS, []);

  function pick(lat: number, lon: number, label?: string) {
    onPick({
      lat,
      lon,
      label: label ?? formatCoordLabel(lat, lon),
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
          Click map for model sounding
        </p>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {MAP_REGIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRegionId(r.id)}
              className={cn(
                "rounded-lg border px-2 py-1 text-[11px] font-semibold transition",
                regionId === r.id
                  ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/15 text-[var(--cyan)]"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white",
              )}
            >
              {r.short}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={shellRef}
        className="skywatch-map relative h-[min(42vh,420px)] min-h-[260px] overflow-hidden rounded-2xl border border-white/10 bg-[#070b16]"
      >
        <MapContainer
          center={[place.lat, place.lon]}
          zoom={5}
          minZoom={3}
          maxZoom={12}
          className="h-full w-full cursor-crosshair"
          zoomControl={false}
          attributionControl
        >
          <FitRegion bounds={bounds} regionId={regionId} />
          <FollowSelection lat={place.lat} lon={place.lon} />
          <ClickPicker onPick={(lat, lon) => pick(lat, lon)} />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            attribution="Esri"
          />
          <LeafletMapAnnotations settings={MAP_SETTINGS} />

          {stations.map((s) => (
            <CircleMarker
              key={s.wmo}
              center={[s.lat, s.lon]}
              radius={4}
              pathOptions={{
                color: "#67e8f9",
                fillColor: "#0b1224",
                fillOpacity: 0.9,
                weight: 1.5,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  pick(s.lat, s.lon, `${s.name}, ${s.state}`);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                {s.name}, {s.state}
              </Tooltip>
            </CircleMarker>
          ))}

          <Marker position={[place.lat, place.lon]} icon={pinIcon}>
            <Tooltip permanent direction="top" offset={[0, -10]}>
              {place.label}
            </Tooltip>
          </Marker>

          <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-2">
            <MapFullscreenButton target={fullscreenTarget} compact />
            <RecenterButton bounds={bounds} regionId={regionId} />
          </div>
        </MapContainer>

        <p className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-full border border-white/15 bg-[#0b1224]/85 px-3 py-1 text-[11px] text-white/70 backdrop-blur-md">
          Cyan rings = radiosonde sites · click anywhere for a model profile
        </p>
      </div>
    </div>
  );
}
