"use client";

import { useEffect, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  ImageOverlay,
  Marker,
  Popup,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { LocateFixed } from "lucide-react";
import {
  CITY_MARKERS,
  DEFAULT_MAP_REGION,
  getMapRegion,
  type MapMode,
  type MapRegionId,
  type MapSettingsState,
  type RegionBounds,
} from "@/components/home/mock-data";
import { LeafletMapAnnotations } from "@/components/home/leaflet-map-annotations";
import {
  LeafletLightningOverlay,
  SatelliteLightningOverlay,
} from "@/components/home/lightning-overlay";
import {
  LeafletSynopticOverlay,
  SatelliteSynopticOverlay,
} from "@/components/home/synoptic-overlay";
import {
  LeafletStationOverlay,
  SatelliteStationOverlay,
} from "@/components/home/station-overlay";
import { SatelliteMapAnnotations } from "@/components/home/satellite-map-annotations";
import type { WeatherStation } from "@/lib/weather/stations";
import { MapFullscreenButton } from "@/components/home/map-fullscreen";
import { MapChromeFix } from "@/components/home/map-chrome-fix";
import {
  RadarFramePreloader,
  SmoothRadarLayer,
} from "@/components/home/smooth-radar-layer";
import { RiskPolygonLayer } from "@/components/risk/risk-polygon-layer";
import { StormCellOverlay } from "@/components/home/storm-cell-overlay";
import type { DisplayFeature } from "@/lib/forecast/types";
import type { LightningStrike } from "@/lib/weather/lightning";
import type { StormCell } from "@/lib/weather/storm-cell-types";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import {
  GIBS_AU_ASPECT,
  boundsMercatorAspect,
  lonLatToBoundsPct,
  type WeatherFrame,
} from "@/lib/weather/maps";
import { useWarnings } from "@/hooks/use-warnings";
import type {
  BomWarningDetail,
  BomWarningSummary,
} from "@/lib/weather/warnings";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const AUSTRALIA_MAP_BOUNDS = [
  [-48, 100],
  [-5, 170],
] as [[number, number], [number, number]];

const BOM_RADAR_SITES = [
  { name: "Darwin", lat: -12.46, lng: 130.84 },
  { name: "Townsville", lat: -19.25, lng: 146.77 },
  { name: "Cairns", lat: -16.93, lng: 145.77 },
  { name: "Brisbane", lat: -27.47, lng: 153.03 },
  { name: "Sydney", lat: -33.86, lng: 151.21 },
  { name: "Melbourne", lat: -37.81, lng: 144.96 },
  { name: "Adelaide", lat: -34.93, lng: 138.6 },
  { name: "Perth", lat: -31.95, lng: 115.86 },
  { name: "Hobart", lat: -42.88, lng: 147.33 },
  { name: "Alice Springs", lat: -23.7, lng: 133.88 },
  { name: "Broome", lat: -17.95, lng: 122.23 },
  { name: "Geraldton", lat: -28.78, lng: 114.61 },
  { name: "Longreach", lat: -23.44, lng: 144.26 },
] as const;

function warningDisplayTitle(warning: BomWarningSummary): string {
  const text = warning.shortTitle || warning.title || "Warning";
  return text.replace(/\s+/g, " ").trim();
}

function fallbackWarningPoint(warning: BomWarningSummary): {
  lat: number;
  lng: number;
} {
  const stateMap: Record<string, [number, number]> = {
    nsw: [-32.9, 147.6],
    vic: [-37.2, 144.8],
    qld: [-24.5, 145.6],
    wa: [-25.3, 121.8],
    sa: [-31.5, 135.8],
    tas: [-42.0, 146.8],
    nt: [-20.8, 133.8],
    act: [-35.5, 149.1],
  };

  const state = (warning.states[0] || warning.state).toLowerCase();
  const point = stateMap[state];
  if (point) {
    return { lat: point[0], lng: point[1] };
  }

  return { lat: -25.3, lng: 133.8 };
}

const bomWarningIcon = L.divIcon({
  className: "",
  html: '<span style="display:flex;width:28px;height:28px;align-items:center;justify-content:center;border:2px solid #fff;border-radius:4px;background:#c2410c;color:#fff;font-size:18px;font-weight:800;box-shadow:0 1px 5px #0009">!</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

type LiveLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

const liveLocationIcon = L.divIcon({
  className: "",
  html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64" width="36" height="48" style="filter:drop-shadow(0 1px 3px #0009)"><path fill="#c8102e" d="M24 0C10.75 0 0 10.75 0 24c0 6.2 2.4 11.6 6.2 17.1L19.4 61c2.1 4 7.1 4 9.2 0l13.2-19.9C45.6 35.6 48 30.2 48 24 48 10.75 37.25 0 24 0Z"/><circle cx="24" cy="24" r="9.5" fill="#fff"/></svg>',
  iconSize: [36, 48],
  iconAnchor: [18, 45],
});

function useLiveLocation(enabled: boolean): {
  position: LiveLocation | null;
  error: string | null;
} {
  const [position, setPosition] = useState<LiveLocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPosition(null);
      setError(null);
      return;
    }

    if (!navigator.geolocation) {
      setError("Location is not supported by this browser.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setPosition({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
        });
        setError(null);
      },
      (locationError) => {
        setError(
          locationError.code === locationError.PERMISSION_DENIED
            ? "Allow location access in your browser to show your position."
            : "Your live location is temporarily unavailable.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 20_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  return { position, error };
}

function LiveLocationStatus({
  enabled,
  position,
  error,
}: {
  enabled: boolean;
  position: LiveLocation | null;
  error: string | null;
}) {
  if (!enabled || (position && !error)) return null;

  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-3 left-3 z-[1001] max-w-[min(22rem,calc(100%-1.5rem))] rounded-md border border-white/15 bg-[#0f172a]/95 px-3 py-2 text-xs text-white shadow-lg"
    >
      {error ?? "Finding your live location…"}
    </div>
  );
}

function LiveLocationMarker({ position }: { position: LiveLocation }) {
  const point: [number, number] = [position.latitude, position.longitude];
  const accuracy = Math.max(10, position.accuracy);

  return (
    <>
      <Circle
        center={point}
        radius={accuracy}
        pathOptions={{
          color: "#38bdf8",
          weight: 1.5,
          fillColor: "#38bdf8",
          fillOpacity: 0.12,
        }}
      />
      <Marker position={point} icon={liveLocationIcon} zIndexOffset={2000}>
        <Tooltip direction="top" offset={[0, -12]}>
          Your live location (accuracy ±{Math.round(position.accuracy)} m)
        </Tooltip>
      </Marker>
    </>
  );
}

function SatelliteLiveLocation({
  position,
  bounds,
}: {
  position: LiveLocation;
  bounds: RegionBounds;
}) {
  const { x, y } = lonLatToBoundsPct(
    position.longitude,
    position.latitude,
    bounds,
  );
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <span
        aria-label={`Your live location, accuracy about ${Math.round(position.accuracy)} metres`}
        title={`Your live location (accuracy ±${Math.round(position.accuracy)} m)`}
        className="pointer-events-auto absolute h-12 w-9 -translate-x-1/2 -translate-y-[94%] drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
        style={{ left: `${x}%`, top: `${y}%` }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 48 64"
          className="h-full w-full"
        >
          <path
            fill="#c8102e"
            d="M24 0C10.75 0 0 10.75 0 24c0 6.2 2.4 11.6 6.2 17.1L19.4 61c2.1 4 7.1 4 9.2 0l13.2-19.9C45.6 35.6 48 30.2 48 24 48 10.75 37.25 0 24 0Z"
          />
          <circle cx="24" cy="24" r="9.5" fill="#fff" />
        </svg>
      </span>
    </div>
  );
}

function RadarSitesOverlay({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  return (
    <>
      {BOM_RADAR_SITES.map((site) => (
        <CircleMarker
          key={site.name}
          center={[site.lat, site.lng]}
          radius={4}
          pathOptions={{
            color: "#7f1d1d",
            weight: 1,
            fillColor: "#ef4444",
            fillOpacity: 1,
          }}
        />
      ))}
    </>
  );
}

function BomWarningOverlay({
  enabled,
  warnings,
}: {
  enabled: boolean;
  warnings: BomWarningSummary[];
}) {
  if (!enabled) return null;

  const items = warnings.filter((warning) => {
    const type = warning.type.toLowerCase();
    return (
      warning.severity !== "cancelled" &&
      (type.includes("severe_weather_warning") ||
        type.includes("severe_thunderstorm_warning"))
    );
  });

  return (
    <>
      {items.map((warning) => (
        <BomWarningMapMarker key={warning.id} warning={warning} />
      ))}
    </>
  );
}

function BomWarningMapMarker({ warning }: { warning: BomWarningSummary }) {
  const [detail, setDetail] = useState<BomWarningDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadOfficialMap = () => {
    if (detail || loading) return;
    setLoading(true);
    void fetch(`/api/weather/warnings/${encodeURIComponent(warning.id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Warning map unavailable");
        const payload = (await response.json()) as {
          warning: BomWarningDetail;
        };
        setDetail(payload.warning);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  };

  const openWarning = () => {
    if (
      window.confirm(
        `Open the Bureau of Meteorology warning for ${warningDisplayTitle(warning)}?`,
      )
    ) {
      window.location.assign(warning.href);
    }
  };

  const officialMap = detail?.images[0];

  return (
    <Marker
      position={fallbackWarningPoint(warning)}
      icon={bomWarningIcon}
      eventHandlers={{ click: loadOfficialMap }}
    >
      <Tooltip direction="top" offset={[0, -14]}>
        {`Warning location: ${warningDisplayTitle(warning)}`}
      </Tooltip>
      <Popup minWidth={260} maxWidth={320}>
        <div className="space-y-2">
          <p className="font-semibold">{warningDisplayTitle(warning)}</p>
          {officialMap ? (
            <img
              src={officialMap.src}
              alt={`Official Bureau of Meteorology warning map: ${warning.title}`}
              className="block h-auto max-h-64 w-full object-contain"
            />
          ) : loading ? (
            <p className="text-sm">Loading the official BoM warning map…</p>
          ) : detail ? (
            <p className="text-sm">BoM has not provided a map for this warning.</p>
          ) : loadFailed ? (
            <p className="text-sm">The official BoM map could not be loaded.</p>
          ) : (
            <p className="text-sm">Loading the official BoM warning map…</p>
          )}
          <button
            type="button"
            onClick={openWarning}
            className="rounded bg-orange-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600"
          >
            Open warning
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

function ForecastDistrictOverlay({
  enabled,
  warnings,
}: {
  enabled: boolean;
  warnings: BomWarningSummary[];
}) {
  if (!enabled) return null;

  const items = warnings.filter((warning) => {
    const type = warning.type.toLowerCase();
    return (
      type.includes("severe_weather_warning") ||
      type.includes("severe_thunderstorm_warning")
    );
  });

  return (
    <>
      {items.map((warning) => {
        const point = fallbackWarningPoint(warning);
        if (!point) return null;

        return (
          <CircleMarker
            key={`${warning.id}-district`}
            center={[point.lat, point.lng]}
            radius={6}
            pathOptions={{
              color: "#f8fafc",
              weight: 1.2,
              fillColor: warning.severity === "critical" ? "#fca5a5" : "#fde68a",
              fillOpacity: 0.95,
            }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              {warningDisplayTitle(warning)}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

type Props = {
  mode: MapMode;
  regionId?: MapRegionId;
  showRadarOverlay?: boolean;
  /** Leaflet tile URL template for RainViewer frames */
  frameTileUrl?: string | null;
  /** Full-frame IR image (GIBS WMS via proxy) */
  frameImageUrl?: string | null;
  /** Optional live/proxy URL if the primary frame fails to load. */
  frameImageFallbackUrl?: string | null;
  frameImageBounds?: [[number, number], [number, number]] | null;
  frameKey?: string | number;
  frameOpacity?: number;
  frameAlt?: string;
  mapSettings: MapSettingsState;
  showLightning?: boolean;
  lightningStrikes?: LightningStrike[];
  /** Active satellite frame unix time; null = wall clock. */
  lightningReferenceTime?: number | null;
  lightningTimelineStart?: number | null;
  lightningTimelineEnd?: number | null;
  lightningPlaying?: boolean;
  lightningMsPerFrame?: number;
  lightningNextFrameTime?: number | null;
  showSynoptic?: boolean;
  synopticFrames?: SynopticFrame[];
  synopticGeoJson?: SynopticGeoJson | null;
  synopticValidTime?: number | null;
  synopticReferenceTime?: number | null;
  showStations?: boolean;
  stations?: WeatherStation[];
  /** Latest Himawari frame for Map-mode satellite overlay (optional). */
  mapSatelliteImageUrl?: string | null;
  mapSatelliteImageBounds?: [[number, number], [number, number]] | null;
  /** Radar timeline frames for prefetch / smooth playback. */
  radarLoopFrames?: WeatherFrame[];
  radarFrameIndex?: number;
  /** Official BoM thunderstorm forecast chart (risk page). */
  riskImageUrl?: string | null;
  riskImageBounds?: [[number, number], [number, number]] | null;
  /** sheet = product graphic over map; geo = georeferenced plate */
  riskImageDisplay?: "sheet" | "geo";
  riskImageOpacity?: number;
  /** Convective risk polygons (Day 1–3 outlook). */
  riskFeatures?: DisplayFeature[];
  /** Optional map click probe (e.g. ECMWF models page). */
  onMapClick?: (ll: { lat: number; lng: number }) => void;
  probePoint?: {
    lat: number;
    lng: number;
    label?: string | null;
  } | null;
  /** Optional second probe / transect end. */
  probePointB?: {
    lat: number;
    lng: number;
    label?: string | null;
  } | null;
  /** Draw a transect line between A and B when both set. */
  showTransectLine?: boolean;
  stormCells?: StormCell[];
  showStormCells?: boolean;
  selectedStormCellId?: string | null;
  focusStormCellId?: string | null;
  onSelectStormCell?: (id: string | null) => void;
};

function MapClickHandler({
  onMapClick,
}: {
  onMapClick?: (ll: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function MapModeEffect({ mode }: { mode: MapMode }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().dataset.mapMode = mode;
  }, [map, mode]);
  return null;
}

function regionFitPaddingPx(isNational: boolean, width: number): number {
  // Keep padding light on narrow phones so tall/wide states still fit fully.
  if (isNational) return width < 640 ? 4 : 8;
  if (width < 480) return 8;
  if (width < 768) return 14;
  return 28;
}

function FitRegionBounds({
  bounds,
  animate = true,
  isNational = false,
  padding,
}: {
  bounds: RegionBounds;
  animate?: boolean;
  isNational?: boolean;
  /** Fixed padding override; when omitted, scales down on mobile. */
  padding?: number;
}) {
  const map = useMap();
  const key = `${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`;
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const regionChanged = lastKeyRef.current !== key;
    if (regionChanged) {
      lastKeyRef.current = key;
    }

    const fit = (withAnimate: boolean) => {
      const pad =
        padding ??
        regionFitPaddingPx(
          isNational,
          map.getContainer().clientWidth || window.innerWidth,
        );
      map.fitBounds(bounds, {
        animate: withAnimate,
        padding: [pad, pad],
        // Avoid over-zooming ACT/TAS on tall phones and clipping edges.
        maxZoom: isNational ? 6 : 9,
      });
    };

    // Only auto-fit when the region changes (or first mount). Resize / layout
    // shifts must not yank a zoomed-in radar view back to national framing.
    if (regionChanged) {
      fit(animate);
    }

    const onResize = () => {
      map.invalidateSize({ animate: false });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map, key, animate, padding, bounds, isNational]);
  return null;
}

function MapTools({
  bounds,
  isNational,
  fullscreenTarget,
}: {
  bounds: RegionBounds;
  isNational: boolean;
  fullscreenTarget: HTMLElement | null;
}) {
  const map = useMap();

  useEffect(() => {
    const onFs = () => {
      window.setTimeout(() => map.invalidateSize({ animate: false }), 80);
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, [map]);

  return (
    <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-2">
      <MapFullscreenButton target={fullscreenTarget} compact />
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-[#0f172a]/90 text-white shadow-lg backdrop-blur-md transition hover:border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/15 hover:text-[var(--cyan)]"
        aria-label="Recentre on selected region"
        onClick={() => {
          const pad = regionFitPaddingPx(
            isNational,
            map.getContainer().clientWidth || window.innerWidth,
          );
          map.fitBounds(bounds, {
            animate: true,
            padding: [pad, pad],
            maxZoom: isNational ? 6 : 9,
          });
        }}
      >
        <LocateFixed className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * RainViewer tiles over the fixed national Himawari frame.
 */
function SatelliteRadarOverlay({
  tileUrl,
  bounds,
  smoothed = false,
}: {
  tileUrl: string;
  bounds: RegionBounds;
  smoothed?: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[4]">
      <MapContainer
        center={[-25.5, 134.5]}
        zoom={4}
        className="h-full w-full !bg-transparent [&_.leaflet-container]:!bg-transparent [&_.leaflet-tile-pane]:!opacity-100"
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        doubleClickZoom={false}
        scrollWheelZoom={false}
        boxZoom={false}
        keyboard={false}
        touchZoom={false}
        style={{ background: "transparent" }}
      >
        <MapChromeFix />
        <FitRegionBounds
          bounds={bounds}
          animate={false}
          padding={0}
          isNational={false}
        />
        <SmoothRadarLayer url={tileUrl} opacity={0.88} smoothed={smoothed} />
      </MapContainer>
    </div>
  );
}

/**
 * Hold the last good frame until the next URL is ready — but only within the
 * same product/region loop. Crossing products must clear immediately so IR
 * never keeps showing Air Mass / Visible while the next loop buffers.
 */
function SatelliteFrameView({
  url,
  alt,
  opacity = 1,
  loopKey,
  fallbackUrl = null,
}: {
  url: string | null;
  alt: string;
  opacity?: number;
  /** Product + region identity; changing this drops any held frame. */
  loopKey?: string;
  /** Tried after primary URL exhausts retries (e.g. live frame proxy). */
  fallbackUrl?: string | null;
}) {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const displayRef = useRef<string | null>(null);
  const loadingRef = useRef<string | null>(null);
  const loopKeyRef = useRef(loopKey);
  const loadGenRef = useRef(0);

  useEffect(() => {
    if (loopKeyRef.current === loopKey) return;
    loopKeyRef.current = loopKey;
    displayRef.current = null;
    loadingRef.current = null;
    loadGenRef.current += 1;
    setDisplayUrl(null);
    setFailed(false);
  }, [loopKey]);

  useEffect(() => {
    if (!url) {
      // Keep last decoded frame if the URL briefly goes null during scrub.
      loadingRef.current = null;
      setFailed(false);
      return;
    }
    if (url === displayRef.current || url === loadingRef.current) {
      setFailed(false);
      return;
    }

    const gen = ++loadGenRef.current;
    let attempts = 0;
    let usingFallback = false;
    let activeUrl = url;
    let fallbackTimer: number | null = null;
    loadingRef.current = url;
    setFailed(false);
    const isArchive = url.includes("/api/weather/archive/frame");
    const maxAttempts = isArchive ? 2 : 2;
    const retryDelayMs = isArchive ? 600 : 400;

    const commit = (committedUrl: string) => {
      if (gen !== loadGenRef.current) return;
      displayRef.current = committedUrl;
      loadingRef.current = null;
      setDisplayUrl(committedUrl);
      setFailed(false);
    };

    const load = () => {
      if (gen !== loadGenRef.current) return;
      attempts += 1;
      const img = new window.Image();
      const src =
        attempts === 1 ? activeUrl : `${activeUrl}&retry=${attempts}`;
      img.onload = () => commit(activeUrl);
      img.onerror = () => {
        if (gen !== loadGenRef.current) return;
        if (attempts < maxAttempts) {
          window.setTimeout(load, retryDelayMs);
          return;
        }
        if (!usingFallback && fallbackUrl) {
          usingFallback = true;
          attempts = 0;
          activeUrl = fallbackUrl;
          window.setTimeout(load, 80);
          return;
        }
        loadingRef.current = null;
        // Never blank a previously good frame — hold it to avoid flicker.
        setFailed(!displayRef.current);
      };
      img.src = src;
      if (img.complete && img.naturalWidth > 0) {
        commit(activeUrl);
      }
    };

    load();
    // Archive: kick the live proxy in parallel after a short wait so a cold
    // capture cannot pin the UI on "Loading archive frame…".
    if (isArchive && fallbackUrl) {
      fallbackTimer = window.setTimeout(() => {
        if (gen !== loadGenRef.current) return;
        if (displayRef.current || usingFallback) return;
        usingFallback = true;
        attempts = 0;
        activeUrl = fallbackUrl;
        load();
      }, 1400);
    }
    return () => {
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
      if (loadingRef.current === url) loadingRef.current = null;
    };
  }, [url, fallbackUrl]);

  if (!displayUrl) {
    const archive = url?.includes("/api/weather/archive/frame");
    return (
      <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-[#0a1628]/92 px-4 text-center text-sm text-white/70">
        {failed
          ? archive
            ? "Archive frame still capturing — scrub slightly or wait a moment…"
            : "Satellite frame unavailable — scrub or wait for the next refresh…"
          : archive
            ? "Loading archive frame…"
            : "Loading satellite frames…"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displayUrl}
      alt={alt}
      className="absolute inset-0 h-full w-full object-fill select-none"
      style={{ opacity }}
      draggable={false}
    />
  );
}

export function HomeMap({
  mode,
  regionId = DEFAULT_MAP_REGION,
  showRadarOverlay = false,
  frameTileUrl = null,
  frameOpacity = 1,
  frameAlt = "Satellite loop frame",
  frameImageUrl = null,
  frameImageFallbackUrl = null,
  frameKey,
  mapSettings,
  showLightning = false,
  lightningStrikes = [],
  lightningReferenceTime = null,
  lightningTimelineStart = null,
  lightningTimelineEnd = null,
  lightningPlaying = false,
  lightningMsPerFrame = 500,
  lightningNextFrameTime = null,
  showSynoptic = false,
  synopticFrames = [],
  synopticGeoJson = null,
  synopticValidTime = null,
  synopticReferenceTime = null,
  showStations = false,
  stations = [],
  mapSatelliteImageUrl = null,
  mapSatelliteImageBounds = null,
  radarLoopFrames = [],
  radarFrameIndex = 0,
  riskImageUrl = null,
  riskImageBounds = null,
  riskImageDisplay = "sheet",
  riskImageOpacity = 0.92,
  riskFeatures = [],
  onMapClick,
  probePoint = null,
  probePointB = null,
  showTransectLine = false,
  stormCells = [],
  showStormCells = false,
  selectedStormCellId = null,
  focusStormCellId = null,
  onSelectStormCell,
}: Props) {
  const region = getMapRegion(regionId);
  const bounds = region.bounds;
  const isNational = regionId === "national";
  const satelliteLoop = mode === "Static";
  const satelliteBasemap = mapSettings.satelliteBasemap;
  const radarTiles = frameTileUrl && showRadarOverlay ? frameTileUrl : null;
  const radarSmoothed = mapSettings.radarSmoothing;
  const satAspect = isNational
    ? GIBS_AU_ASPECT
    : boundsMercatorAspect(bounds);
  const useSatelliteBasemap = satelliteBasemap;
  const { position: liveLocation, error: liveLocationError } = useLiveLocation(
    mapSettings.liveLocation,
  );
  const { warnings } = useWarnings();
  const lightningIconStyle = mapSettings.lightningBolts
    ? ("bolt" as const)
    : ("crosshair" as const);
  const lightningIconScale = mapSettings.lightningIconScale ?? 1;
  const mapShellRef = useRef<HTMLDivElement>(null);
  const [fullscreenTarget, setFullscreenTarget] = useState<HTMLElement | null>(
    null,
  );

  useEffect(() => {
    setFullscreenTarget(mapShellRef.current);
  }, [satelliteLoop, regionId]);

  // Esri Canvas dark base. Unloaded areas must stay navy (not Leaflet #ddd) —
  // see globals.css. keepBuffer + updateWhenZooming:false cut grey flash on pan.
  const basemapUrl = useSatelliteBasemap
    ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
  const basemapAttr = useSatelliteBasemap ? "Esri World Imagery" : "Esri";
  const darkTilePlaceholder =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  // Satellite: full-bleed region crop (national or state) — image is already
  // georeferenced to `bounds`, so CSS overlays use the same projection.
  // Aspect must match the crop so mobile viewports don't clip the state.
  // Static mode always shows satellite loop; satelliteBasemap toggle affects Zoomable mode.
  if (satelliteLoop) {
    return (
      <div
        ref={mapShellRef}
        className="skywatch-map relative z-0 w-full overflow-hidden bg-black"
        style={{ aspectRatio: `${satAspect}` }}
        data-map-mode="Static"
        data-region={regionId}
      >
        <div className="absolute right-3 top-3 z-[20]">
          <MapFullscreenButton target={fullscreenTarget} compact />
        </div>
        <div className="absolute inset-0 z-10">
          <SatelliteFrameView
            key={
              typeof frameKey === "string"
                ? frameKey.replace(/-\d+$/, "")
                : regionId
            }
            loopKey={
              typeof frameKey === "string"
                ? frameKey.replace(/-\d+$/, "")
                : String(regionId)
            }
            url={frameImageUrl}
            fallbackUrl={frameImageFallbackUrl}
            alt={frameAlt}
            opacity={frameOpacity}
          />
        </div>
        {showRadarOverlay && frameTileUrl ? (
          <div className="absolute inset-0 z-20">
            <SatelliteRadarOverlay
              tileUrl={frameTileUrl}
              bounds={bounds}
              smoothed={radarSmoothed}
            />
          </div>
        ) : null}
        <SatelliteSynopticOverlay
          frames={synopticFrames}
          enabled={showSynoptic}
          referenceTime={synopticReferenceTime}
          geojson={synopticGeoJson}
          validTime={synopticValidTime}
          bounds={bounds}
        />
        <SatelliteMapAnnotations
          settings={mapSettings}
          cities={CITY_MARKERS}
          bounds={bounds}
        />
        <SatelliteLightningOverlay
          strikes={lightningStrikes}
          enabled={showLightning}
          referenceTime={lightningReferenceTime}
          timelineStart={lightningTimelineStart}
          timelineEnd={lightningTimelineEnd}
          playing={lightningPlaying}
          msPerFrame={lightningMsPerFrame}
          nextFrameTime={lightningNextFrameTime}
          bounds={bounds}
          iconStyle={lightningIconStyle}
          iconScale={lightningIconScale}
        />
        <SatelliteStationOverlay
          stations={stations}
          enabled={showStations}
          bounds={bounds}
          colorCoded={mapSettings.stationColorValues}
        />
        {liveLocation ? (
          <SatelliteLiveLocation position={liveLocation} bounds={bounds} />
        ) : null}
        <LiveLocationStatus
          enabled={mapSettings.liveLocation}
          position={liveLocation}
          error={liveLocationError}
        />
      </div>
    );
  }

  return (
    <div
      ref={mapShellRef}
      className="skywatch-map relative z-0 h-full min-h-[280px] w-full overflow-hidden sm:min-h-[360px]"
    >
      <MapContainer
        center={[-25.5, 134.5]}
        zoom={4}
        minZoom={3}
        maxZoom={18}
        maxBounds={AUSTRALIA_MAP_BOUNDS}
        maxBoundsViscosity={1.0}
        className="h-full w-full !bg-[#0a1628]"
        style={{ background: "#0a1628" }}
        zoomControl={false}
        attributionControl
        fadeAnimation={false}
      >
        <MapChromeFix />
        <MapModeEffect mode={mode} />
        <MapClickHandler onMapClick={onMapClick} />
        <FitRegionBounds bounds={bounds} animate isNational={isNational} />
        <TileLayer
          key={useSatelliteBasemap ? "sat" : "esri-dark"}
          url={basemapUrl}
          attribution={basemapAttr}
          keepBuffer={16}
          updateWhenZooming={false}
          updateWhenIdle
          maxZoom={18}
          maxNativeZoom={16}
          errorTileUrl={darkTilePlaceholder}
          crossOrigin
        />
        {mapSatelliteImageUrl && mapSatelliteImageBounds ? (
          <ImageOverlay
            key={mapSatelliteImageUrl}
            url={mapSatelliteImageUrl}
            bounds={mapSatelliteImageBounds}
            opacity={useSatelliteBasemap ? 0.55 : 0.82}
            zIndex={350}
            className="skywatch-map-himawari"
          />
        ) : null}
        {riskImageUrl &&
        riskImageDisplay === "geo" &&
        riskImageBounds ? (
          <ImageOverlay
            key={riskImageUrl}
            url={riskImageUrl}
            bounds={riskImageBounds}
            opacity={riskImageOpacity}
            zIndex={420}
            className="skywatch-risk-chart"
          />
        ) : null}
        {radarTiles ? (
          <SmoothRadarLayer
            url={radarTiles}
            opacity={0.88}
            smoothed={radarSmoothed}
          />
        ) : null}
        {mapSettings.radarSites ? <RadarSitesOverlay enabled /> : null}
        {mapSettings.bomWarnings ? (
          <BomWarningOverlay enabled warnings={warnings} />
        ) : null}
        {mapSettings.forecastDistricts ? (
          <ForecastDistrictOverlay enabled warnings={warnings} />
        ) : null}
        {showRadarOverlay && radarLoopFrames.length > 0 ? (
          <RadarFramePreloader
            frames={radarLoopFrames}
            activeIndex={radarFrameIndex}
            enabled
          />
        ) : null}
        {riskFeatures.length > 0 ? (
          <RiskPolygonLayer features={riskFeatures} fit={false} />
        ) : null}
        <LeafletSynopticOverlay
          frames={synopticFrames}
          enabled={showSynoptic}
          referenceTime={synopticReferenceTime}
          geojson={synopticGeoJson}
          validTime={synopticValidTime}
        />
        <LeafletMapAnnotations settings={mapSettings} />
        <LeafletLightningOverlay
          strikes={lightningStrikes}
          enabled={showLightning}
          referenceTime={lightningReferenceTime}
          timelineStart={lightningTimelineStart}
          timelineEnd={lightningTimelineEnd}
          playing={lightningPlaying}
          msPerFrame={lightningMsPerFrame}
          nextFrameTime={lightningNextFrameTime}
          iconStyle={lightningIconStyle}
          iconScale={lightningIconScale}
        />
        <LeafletStationOverlay
          stations={stations}
          enabled={showStations}
          colorCoded={mapSettings.stationColorValues}
        />
        {liveLocation ? <LiveLocationMarker position={liveLocation} /> : null}
        {probePoint ? (
          <CircleMarker
            center={[probePoint.lat, probePoint.lng]}
            radius={9}
            pathOptions={{
              color: "#22d3ee",
              weight: 2,
              fillColor: "#22d3ee",
              fillOpacity: 0.35,
            }}
          >
            {probePoint.label ? (
              <Tooltip permanent direction="top" offset={[0, -8]}>
                {probePoint.label}
              </Tooltip>
            ) : null}
          </CircleMarker>
        ) : null}
        {probePointB ? (
          <CircleMarker
            center={[probePointB.lat, probePointB.lng]}
            radius={9}
            pathOptions={{
              color: "#fbbf24",
              weight: 2,
              fillColor: "#fbbf24",
              fillOpacity: 0.35,
            }}
          >
            {probePointB.label ? (
              <Tooltip permanent direction="top" offset={[0, -8]}>
                {probePointB.label}
              </Tooltip>
            ) : null}
          </CircleMarker>
        ) : null}
        {showTransectLine && probePoint && probePointB ? (
          <Polyline
            positions={[
              [probePoint.lat, probePoint.lng],
              [probePointB.lat, probePointB.lng],
            ]}
            pathOptions={{
              color: "#fbbf24",
              weight: 2.5,
              dashArray: "6 4",
              opacity: 0.9,
            }}
          />
        ) : null}
        <StormCellOverlay
          cells={stormCells}
          enabled={showStormCells}
          selectedId={selectedStormCellId}
          focusId={focusStormCellId}
          onSelect={onSelectStormCell}
        />
        <MapTools
          bounds={bounds}
          isNational={isNational}
          fullscreenTarget={fullscreenTarget}
        />
      </MapContainer>
      <LiveLocationStatus
        enabled={mapSettings.liveLocation}
        position={liveLocation}
        error={liveLocationError}
      />
      {riskImageUrl && riskImageDisplay === "sheet" ? (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-[#070b16]/55 p-3 sm:p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={riskImageUrl}
            alt="BoM thunderstorm forecast"
            className="max-h-full max-w-full object-contain shadow-[0_12px_48px_rgba(0,0,0,0.55)]"
            draggable={false}
          />
        </div>
      ) : null}
    </div>
  );
}
