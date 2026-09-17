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
  FrontKind,
  SynopticFeature,
  SynopticGeoJson,
} from "@/lib/weather/synoptic-contour";
import {
  formatFrameTimeAEST,
  GIBS_AU_ASPECT,
  lonLatToGibsPct,
} from "@/lib/weather/maps";

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
        const data = (await res.json()) as { geojson?: SynopticGeoJson };
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

function isFrontKind(kind: string): kind is FrontKind {
  return (
    kind === "cold_front" ||
    kind === "warm_front" ||
    kind === "stationary_front" ||
    kind === "occluded_front" ||
    kind === "trough"
  );
}

function frontStroke(kind: FrontKind): {
  color: string;
  width: number;
  dash?: string;
} {
  switch (kind) {
    case "cold_front":
      return { color: "#2563eb", width: 2.4 };
    case "warm_front":
      return { color: "#dc2626", width: 2.4 };
    case "stationary_front":
      return { color: "#7c3aed", width: 2.2 };
    case "occluded_front":
      return { color: "#a020f0", width: 2.4 };
    case "trough":
      return { color: "#44403c", width: 1.8, dash: "5 3.5" };
  }
}

/** Place classic front barbs along a polyline in the 0–100 viewBox. */
function frontBarbPaths(
  coords: [number, number][],
  kind: FrontKind,
  warmSide?: [number, number],
): string[] {
  if (kind === "trough" || coords.length < 2) return [];
  const pts = coords.map(([lon, lat]) => lonLatToGibsPct(lon, lat));
  const aspect = GIBS_AU_ASPECT; // width/height of frame
  const barbSize = 1.35;
  const spacing = 5.5;
  const paths: string[] = [];

  // Accumulate distance in viewBox units (y scaled by aspect so spacing looks even)
  let dist = 0;
  let nextAt = spacing * 0.5;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = (b.y - a.y) / aspect;
    const seg = Math.hypot(dx, dy);
    if (seg < 1e-6) continue;
    let t0 = 0;
    while (dist + (seg - t0) >= nextAt) {
      const need = nextAt - dist;
      const t = (t0 + need) / seg;
      const x = a.x + dx * t;
      const y = a.y + (b.y - a.y) * t;
      const tx = dx / seg;
      const ty = dy / seg;
      // Perpendicular in screen space. Default: rotate tangent 90° CW so symbols
      // sit on the advance side of typically west→east BoM traces (toward motion).
      let px = ty;
      let py = -tx;
      // warmSide here is the unit vector (east, north) the symbols should point —
      // the side the front is advancing into (BoM chart barb side).
      if (warmSide) {
        const wx = warmSide[0];
        const wy = -warmSide[1] / aspect;
        if (px * wx + py * wy < 0) {
          px = -px;
          py = -py;
        }
      }
      // Alternate for stationary / occluded
      const flip =
        (kind === "stationary_front" || kind === "occluded_front") &&
        paths.length % 2 === 1;
      const side = flip ? -1 : 1;
      const bx = x + px * barbSize * side;
      const by = y + py * barbSize * aspect * side;

      if (
        kind === "cold_front" ||
        ((kind === "stationary_front" || kind === "occluded_front") && !flip)
      ) {
        // Triangle
        const base = barbSize * 0.85;
        const x1 = x - tx * base * 0.5;
        const y1 = y - ty * base * 0.5 * aspect;
        const x2 = x + tx * base * 0.5;
        const y2 = y + ty * base * 0.5 * aspect;
        paths.push(
          `M${x1.toFixed(2)} ${y1.toFixed(2)} L${bx.toFixed(2)} ${by.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
        );
      } else {
        // Semicircle (warm / alt stationary / occluded)
        const r = barbSize * 0.7;
        paths.push(
          `M${x.toFixed(2)} ${y.toFixed(2)} A${r.toFixed(2)} ${(r * aspect).toFixed(2)} 0 0 ${side > 0 ? 1 : 0} ${bx.toFixed(2)} ${by.toFixed(2)}`,
        );
      }

      nextAt += spacing;
      t0 += need;
      dist += need;
    }
    dist += seg - t0;
  }
  return paths;
}

/** Vector isobars, fronts, and H/L over the national satellite plane. */
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
  const fronts = geojson.features.filter(
    (f): f is Extract<SynopticFeature, { properties: { kind: FrontKind } }> =>
      isFrontKind(f.properties.kind),
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
            stroke="rgba(255,255,255,0.92)"
            strokeWidth={f.properties.pressure % 8 === 0 ? 1.7 : 1.15}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{
              filter: "drop-shadow(0 0 0.6px rgba(0,0,0,0.85))",
            }}
          />
        ))}
        {isobars.map((f, i) => (
          <path
            key={`iso-core-${f.properties.pressure}-${i}`}
            d={lineToPath(f.geometry.coordinates)}
            fill="none"
            stroke="rgba(15,15,15,0.88)"
            strokeWidth={f.properties.pressure % 8 === 0 ? 1.15 : 0.75}
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
                fill="rgba(255,255,255,0.95)"
                fontSize="1.75"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  paintOrder: "stroke",
                  stroke: "rgba(0,0,0,0.75)",
                  strokeWidth: 0.45,
                }}
              >
                {f.properties.pressure}
              </text>
            );
          })}

        {fronts.map((f, i) => {
          const stroke = frontStroke(f.properties.kind);
          const warm =
            "warmSide" in f.properties ? f.properties.warmSide : undefined;
          const barbs = frontBarbPaths(
            f.geometry.coordinates,
            f.properties.kind,
            warm,
          );
          return (
            <g key={`front-${f.properties.kind}-${i}`}>
              <path
                d={lineToPath(f.geometry.coordinates)}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeDasharray={stroke.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {barbs.map((d, bi) => (
                <path
                  key={bi}
                  d={d}
                  fill={
                    f.properties.kind === "warm_front" ||
                    ((f.properties.kind === "stationary_front" ||
                      f.properties.kind === "occluded_front") &&
                      bi % 2 === 1)
                      ? "none"
                      : stroke.color
                  }
                  stroke={stroke.color}
                  strokeWidth={1.1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
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
              className={`text-2xl font-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] sm:text-3xl ${
                high ? "text-red-500" : "text-sky-300"
              }`}
            >
              {f.properties.label}
            </div>
            <div className="text-[10px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:text-[11px]">
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
  if (!props) return { opacity: 0 };
  if (props.kind === "isobar") {
    const bold = props.pressure % 8 === 0;
    return {
      color: "#f8fafc",
      weight: bold ? 2.4 : 1.6,
      opacity: 0.95,
      fillOpacity: 0,
      className: "synoptic-isobar",
    };
  }
  if (isFrontKind(props.kind)) {
    const s = frontStroke(props.kind);
    return {
      color: s.color,
      weight: s.width + 0.4,
      opacity: 0.95,
      dashArray: s.dash,
      fillOpacity: 0,
    };
  }
  return { opacity: 0 };
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
      <div style="font-size:28px;font-weight:900;color:${high ? "#f87171" : "#7dd3fc"};text-shadow:0 1px 2px rgba(0,0,0,.9)">${props.label}</div>
      <div style="font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.9)">${props.pressure}</div>
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
            MSLP · fronts · {formatFrameTimeAEST(time)}
          </p>
          <p className="mt-0.5 text-[9px] text-white/55">
            Isobars 4 hPa · cold / warm / trough
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
