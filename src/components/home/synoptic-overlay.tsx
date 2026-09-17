"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJSON } from "react-leaflet";
import type { PathOptions } from "leaflet";
import L from "leaflet";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import {
  SYNOPTIC_OPACITY,
  pickSynopticFrame,
} from "@/lib/weather/synoptic";
import type {
  SynopticFeature,
  SynopticGeoJson,
} from "@/lib/weather/synoptic-contour";
import { formatFrameTimeAEST, lonLatToGibsPct } from "@/lib/weather/maps";

function useNowTick(enabled: boolean) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function useActiveSynopticFrame(
  enabled: boolean,
  frames: SynopticFrame[],
  referenceTime: number | null | undefined,
) {
  const now = useNowTick(enabled && referenceTime == null);
  const ref = referenceTime ?? now;
  return useMemo(
    () => (enabled ? pickSynopticFrame(frames, ref) : null),
    [enabled, frames, ref],
  );
}

function useSynopticGeoJson(
  enabled: boolean,
  frame: SynopticFrame | null,
  embedded: SynopticGeoJson | null | undefined,
  embeddedTime: number | null | undefined,
) {
  const [geojson, setGeojson] = useState<SynopticGeoJson | null>(null);

  useEffect(() => {
    if (!enabled) {
      setGeojson(null);
      return;
    }
    // Use embedded field when it matches the active frame (±1h).
    if (
      embedded &&
      frame &&
      embeddedTime != null &&
      Math.abs(embeddedTime - frame.time) <= 3600
    ) {
      setGeojson(embedded);
      return;
    }
    if (!frame?.geojsonUrl) {
      setGeojson(embedded ?? null);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(frame.geojsonUrl, {
          signal: ac.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error("field fetch failed");
        const data = (await res.json()) as {
          geojson?: SynopticGeoJson;
        };
        if (!cancelled) setGeojson(data.geojson ?? null);
      } catch {
        if (!cancelled) setGeojson(embedded ?? null);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [enabled, frame?.geojsonUrl, frame?.time, embedded, embeddedTime]);

  return geojson;
}

function lineToPath(coords: [number, number][]): string {
  return coords
    .map(([lon, lat], i) => {
      const { x, y } = lonLatToGibsPct(lon, lat);
      return `${i === 0 ? "M" : "L"}${x.toFixed(3)} ${y.toFixed(3)}`;
    })
    .join(" ");
}

/** Vector isobars + H/L over the national satellite plane. */
export function SatelliteSynopticOverlay({
  frames,
  enabled,
  referenceTime = null,
  geojson: embedded = null,
  validTime = null,
  opacity = SYNOPTIC_OPACITY,
}: {
  frames: SynopticFrame[];
  enabled: boolean;
  referenceTime?: number | null;
  geojson?: SynopticGeoJson | null;
  validTime?: number | null;
  opacity?: number;
}) {
  const frame = useActiveSynopticFrame(enabled, frames, referenceTime);
  const geojson = useSynopticGeoJson(enabled, frame, embedded, validTime);

  if (!enabled || !geojson) return null;

  const isobars = geojson.features.filter(
    (f): f is Extract<SynopticFeature, { properties: { kind: "isobar" } }> =>
      f.properties.kind === "isobar",
  );
  const centres = geojson.features.filter(
    (f) => f.properties.kind === "high" || f.properties.kind === "low",
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      style={{ opacity }}
      aria-hidden
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        shapeRendering="geometricPrecision"
      >
        {isobars.map((f, i) => (
          <path
            key={`iso-${f.properties.pressure}-${i}`}
            d={lineToPath(f.geometry.coordinates)}
            fill="none"
            stroke="rgba(20,20,20,0.78)"
            strokeWidth={f.properties.pressure % 8 === 0 ? 1.35 : 0.85}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {isobars
          .filter((f) => f.properties.pressure % 8 === 0)
          .map((f, i) => {
            const mid =
              f.geometry.coordinates[
                Math.floor(f.geometry.coordinates.length / 2)
              ];
            if (!mid) return null;
            const { x, y } = lonLatToGibsPct(mid[0], mid[1]);
            return (
              <text
                key={`lbl-${f.properties.pressure}-${i}`}
                x={x}
                y={y}
                fill="rgba(15,15,15,0.9)"
                fontSize="1.7"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.65)", strokeWidth: 0.35 }}
              >
                {f.properties.pressure}
              </text>
            );
          })}
      </svg>
      {centres.map((f, i) => {
        if (f.properties.kind !== "high" && f.properties.kind !== "low") {
          return null;
        }
        const coords = f.geometry.coordinates;
        const lon = coords[0] as number;
        const lat = coords[1] as number;
        const { x, y } = lonLatToGibsPct(lon, lat);
        const high = f.properties.kind === "high";
        return (
          <div
            key={`c-${f.properties.kind}-${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center leading-none"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div
              className={`text-2xl font-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.85)] sm:text-3xl ${
                high ? "text-red-700" : "text-blue-800"
              }`}
            >
              {f.properties.label}
            </div>
            <div className="text-[10px] font-bold text-black/80 sm:text-[11px]">
              {f.properties.pressure}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function leafletStyle(feature?: GeoJSON.Feature): PathOptions {
  const props = feature?.properties as SynopticFeature["properties"] | undefined;
  if (!props || props.kind !== "isobar") {
    return { opacity: 0 };
  }
  const bold = props.pressure % 8 === 0;
  return {
    color: "#1a1a1a",
    weight: bold ? 2 : 1.15,
    opacity: 0.82,
    fillOpacity: 0,
  };
}

/** Leaflet vector layer for Map / Radar. */
export function LeafletSynopticOverlay({
  frames,
  enabled,
  referenceTime = null,
  geojson: embedded = null,
  validTime = null,
  opacity = SYNOPTIC_OPACITY,
}: {
  frames: SynopticFrame[];
  enabled: boolean;
  referenceTime?: number | null;
  geojson?: SynopticGeoJson | null;
  validTime?: number | null;
  opacity?: number;
}) {
  const frame = useActiveSynopticFrame(enabled, frames, referenceTime);
  const geojson = useSynopticGeoJson(enabled, frame, embedded, validTime);
  if (!enabled || !geojson) return null;

  const pointToLayer = (
    feature: GeoJSON.Feature,
    latlng: L.LatLng,
  ): L.Layer => {
    const props = feature.properties as SynopticFeature["properties"];
    if (props.kind !== "high" && props.kind !== "low") {
      return L.circleMarker(latlng, { radius: 0, opacity: 0 });
    }
    const high = props.kind === "high";
    const html = `<div style="text-align:center;line-height:1;transform:translate(-50%,-50%)">
      <div style="font-size:28px;font-weight:900;color:${high ? "#b91c1c" : "#1e40af"};text-shadow:0 1px 1px rgba(255,255,255,.9)">${props.label}</div>
      <div style="font-size:11px;font-weight:700;color:#111">${props.pressure}</div>
    </div>`;
    return L.marker(latlng, {
      interactive: false,
      icon: L.divIcon({
        className: "synoptic-hl",
        html,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
    });
  };

  return (
    <GeoJSON
      key={`${frame?.stamp ?? "latest"}-${geojson.features.length}`}
      data={geojson as GeoJSON.FeatureCollection}
      style={leafletStyle}
      pointToLayer={pointToLayer}
      pathOptions={{ opacity }}
    />
  );
}

export function SynopticLegend({
  frames,
  attribution,
  referenceTime = null,
  loading,
  error,
  validTime = null,
}: {
  frames: SynopticFrame[];
  attribution?: string | null;
  referenceTime?: number | null;
  loading?: boolean;
  error?: string | null;
  validTime?: number | null;
}) {
  const now = Math.floor(Date.now() / 1000);
  const ref = referenceTime ?? validTime ?? now;
  const frame = pickSynopticFrame(frames, ref);
  const time = frame?.time ?? validTime;

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-[1000] max-w-[15rem] border border-white/25 bg-black/70 px-2.5 py-2 text-white backdrop-blur-sm">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--bom-yellow)]">
        Synoptic chart
      </p>
      {error ? (
        <p className="text-[10px] text-red-300">{error}</p>
      ) : loading && !time ? (
        <p className="text-[10px] text-white/75">Loading MSLP field…</p>
      ) : time ? (
        <>
          <p className="text-[11px] text-white/90">
            MSLP isobars · {formatFrameTimeAEST(time)}
          </p>
          <p className="mt-0.5 text-[9px] text-white/55">
            Georeferenced model field (4 hPa)
          </p>
        </>
      ) : (
        <p className="text-[10px] text-white/75">No field available</p>
      )}
      {attribution ? (
        <p className="mt-1.5 text-[8px] leading-snug text-white/45">
          {attribution}
        </p>
      ) : null}
    </div>
  );
}
