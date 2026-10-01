"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  GIBS_AU_ASPECT,
  lonLatToBoundsPct,
  type LonLatBounds,
} from "@/lib/weather/maps";
import {
  getCachedSynopticGeoJson,
  loadSynopticGeoJson,
  seedSynopticGeoJson,
} from "@/lib/weather/synoptic-geojson-cache";

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

/**
 * Resolve the GeoJSON for the active synoptic analysis hour.
 * Uses an in-memory cache so satellite scrub/play never blanks the overlay
 * while a (usually already-prefetched) field loads.
 */
function useSynopticGeoJson(
  enabled: boolean,
  frame: SynopticFrame | null,
  embedded: SynopticGeoJson | null | undefined,
  embeddedTime: number | null | undefined,
) {
  const url = frame?.geojsonUrl ?? null;
  const holdRef = useRef<SynopticGeoJson | null>(null);
  const [version, setVersion] = useState(0);

  // Seed catalog embedded latest into the shared cache once.
  useEffect(() => {
    if (!embedded || embeddedTime == null || !frame) return;
    if (Math.abs(embeddedTime - frame.time) > 900) return;
    if (!frame.geojsonUrl) return;
    seedSynopticGeoJson(frame.geojsonUrl, embedded);
    holdRef.current = embedded;
    setVersion((v) => v + 1);
  }, [embedded, embeddedTime, frame?.geojsonUrl, frame?.time]);

  useEffect(() => {
    if (!enabled || !url) return;
    if (getCachedSynopticGeoJson(url)) {
      holdRef.current = getCachedSynopticGeoJson(url);
      setVersion((v) => v + 1);
      return;
    }
    let cancelled = false;
    void loadSynopticGeoJson(url).then((geojson) => {
      if (cancelled || !geojson) return;
      holdRef.current = geojson;
      setVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

  return useMemo(() => {
    if (!enabled) return null;
    // Prefer the field for the active analysis hour when cached.
    if (url) {
      const hit = getCachedSynopticGeoJson(url);
      if (hit) {
        holdRef.current = hit;
        return hit;
      }
    }
    if (
      embedded &&
      frame &&
      embeddedTime != null &&
      Math.abs(embeddedTime - frame.time) <= 900
    ) {
      holdRef.current = embedded;
      return embedded;
    }
    // Hold the last drawn chart across analysis swaps / in-flight fetches
    // so the overlay never unmounts to null mid-animation.
    return holdRef.current;
    // version bumps when cache fills; url/frame drive selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, url, frame, embedded, embeddedTime, version]);
}

function lineToPath(coords: [number, number][], bounds?: LonLatBounds): string {
  return coords
    .map(([lon, lat], i) => {
      const { x, y } = lonLatToBoundsPct(lon, lat, bounds);
      return `${i === 0 ? "M" : "L"}${x.toFixed(3)} ${y.toFixed(3)}`;
    })
    .join(" ");
}

/** Catmull–Rom → cubic Bezier path for smooth front curves in the viewBox. */
function lineToSmoothPath(
  coords: [number, number][],
  bounds?: LonLatBounds,
): string {
  if (coords.length < 2) return "";
  const pts = coords.map(([lon, lat]) => lonLatToBoundsPct(lon, lat, bounds));
  if (pts.length === 2) {
    const a = pts[0]!;
    const b = pts[1]!;
    return `M${a.x.toFixed(3)} ${a.y.toFixed(3)} L${b.x.toFixed(3)} ${b.y.toFixed(3)}`;
  }
  let d = `M${pts[0]!.x.toFixed(3)} ${pts[0]!.y.toFixed(3)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? i : i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]!;
    // Centripetal-ish Catmull–Rom → cubic Bezier (tension 0.5)
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(3)} ${c1y.toFixed(3)} ${c2x.toFixed(3)} ${c2y.toFixed(3)} ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
  }
  return d;
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

/** Place classic front barbs along a polyline in the 0–100 viewBox.
 * Polylines are pre-oriented so the advance side is geographic-left; barbs
 * are always drawn to that left. */
function frontBarbPaths(
  coords: [number, number][],
  kind: FrontKind,
  _warmSide?: [number, number],
  bounds?: LonLatBounds,
  aspect: number = GIBS_AU_ASPECT,
): string[] {
  if (kind === "trough" || coords.length < 2) return [];
  const pts = coords.map(([lon, lat]) => lonLatToBoundsPct(lon, lat, bounds));

  const segs: { a: { x: number; y: number }; b: { x: number; y: number }; len: number }[] =
    [];
  let totalLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, (b.y - a.y) / aspect);
    if (len < 1e-6) continue;
    segs.push({ a, b, len });
    totalLen += len;
  }
  if (totalLen < 1.5) return [];

  const isWarm = kind === "warm_front";
  // Semicircle radius in aspect-corrected units. Keep diameter small enough
  // that neighbouring symbols do not merge into a thick red sausage.
  const semiR = isWarm ? 1.25 : 1.2;
  const barbSize = isWarm ? 1.55 : 1.45;
  const spacing = isWarm
    ? Math.max(semiR * 2.5, Math.min(4.2, totalLen / 3.5))
    : 5.2;
  const paths: string[] = [];

  const emitAt = (x: number, y: number, tx: number, ty: number) => {
    const px = ty;
    const py = -tx;
    const alt =
      (kind === "stationary_front" || kind === "occluded_front") &&
      paths.length % 2 === 1;
    const useTriangle =
      kind === "cold_front" ||
      ((kind === "stationary_front" || kind === "occluded_front") && !alt);

    if (useTriangle) {
      const base = barbSize * 0.85;
      const x1 = x - tx * base * 0.5;
      const y1 = y - ty * base * 0.5 * aspect;
      const x2 = x + tx * base * 0.5;
      const y2 = y + ty * base * 0.5 * aspect;
      const bx = x + px * barbSize;
      const by = y + py * barbSize * aspect;
      paths.push(
        `M${x1.toFixed(2)} ${y1.toFixed(2)} L${bx.toFixed(2)} ${by.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
      );
      return;
    }

    const r = semiR;
    const steps = 16;
    let d = "";
    for (let s = 0; s <= steps; s++) {
      const ang = Math.PI * (s / steps);
      const along = -Math.cos(ang);
      const out = Math.sin(ang);
      const sx = x + tx * r * along + px * r * out;
      const sy = y + (ty * r * along + py * r * out) * aspect;
      d += `${s === 0 ? "M" : "L"}${sx.toFixed(2)} ${sy.toFixed(2)} `;
    }
    d += "Z";
    paths.push(d.trim());
  };

  const pointAt = (u: number) => {
    const target = u * totalLen;
    let walk = 0;
    for (const seg of segs) {
      if (walk + seg.len >= target) {
        const tt = (target - walk) / seg.len;
        const x = seg.a.x + (seg.b.x - seg.a.x) * tt;
        const y = seg.a.y + (seg.b.y - seg.a.y) * tt;
        const sdx = seg.b.x - seg.a.x;
        const sdy = (seg.b.y - seg.a.y) / aspect;
        const sl = Math.hypot(sdx, sdy) || 1;
        return { x, y, tx: sdx / sl, ty: sdy / sl };
      }
      walk += seg.len;
    }
    const last = segs[segs.length - 1]!;
    const sdx = last.b.x - last.a.x;
    const sdy = (last.b.y - last.a.y) / aspect;
    const sl = Math.hypot(sdx, sdy) || 1;
    return { x: last.b.x, y: last.b.y, tx: sdx / sl, ty: sdy / sl };
  };

  // Warm / alternating semicircle fronts: place by count so disks never overlap.
  if (isWarm || kind === "stationary_front" || kind === "occluded_front") {
    const minGap = semiR * 2.5;
    let count = Math.round(totalLen / minGap);
    if (isWarm) count = Math.max(3, Math.min(count, 8));
    else count = Math.max(2, Math.min(count, 12));
    if (count < 2) count = 2;
    // If 3 disks would overlap on a very short stub, fall back to 2.
    if (isWarm && totalLen < semiR * 2.5 * 2.2) count = 2;
    // Inset from ends so the first/last disk sits fully on the segment.
    const inset = Math.min(0.22, (semiR * 0.7) / totalLen);
    for (let i = 0; i < count; i++) {
      const u =
        count === 1 ? 0.5 : inset + (i / (count - 1)) * (1 - 2 * inset);
      const p = pointAt(u);
      emitAt(p.x, p.y, p.tx, p.ty);
    }
    return paths;
  }

  // Cold fronts: fixed spacing along the path.
  let dist = 0;
  let nextAt = spacing * 0.45;
  for (const { a, b, len } of segs) {
    const dx = b.x - a.x;
    const dy = (b.y - a.y) / aspect;
    const tx = dx / len;
    const ty = dy / len;
    let t0 = 0;
    while (dist + (len - t0) >= nextAt) {
      const need = nextAt - dist;
      const t = (t0 + need) / len;
      emitAt(a.x + dx * t, a.y + (b.y - a.y) * t, tx, ty);
      nextAt += spacing;
      t0 += need;
      dist += need;
    }
    dist += len - t0;
  }
  return paths;
}

/** Vector isobars, fronts, and H/L over the satellite image plane. */
export function SatelliteSynopticOverlay({
  frames,
  enabled,
  referenceTime = null,
  geojson: embedded = null,
  validTime = null,
  opacity = SYNOPTIC_OPACITY,
  bounds,
}: {
  frames: SynopticFrame[];
  enabled: boolean;
  referenceTime?: number | null;
  geojson?: SynopticGeoJson | null;
  validTime?: number | null;
  opacity?: number;
  bounds?: LonLatBounds;
}) {
  const frame = useActiveSynopticFrame(enabled, frames, referenceTime);
  const geojson = useSynopticGeoJson(enabled, frame, embedded, validTime);
  const frameAspect = bounds
    ? (() => {
        const [[south, west], [north, east]] = bounds;
        return Math.max(0.2, (east - west) / Math.max(0.1, north - south));
      })()
    : GIBS_AU_ASPECT;

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
            d={lineToPath(f.geometry.coordinates, bounds)}
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
            d={lineToPath(f.geometry.coordinates, bounds)}
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
            const { x, y } = lonLatToBoundsPct(mid[0], mid[1], bounds);
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
            bounds,
            frameAspect,
          );
          return (
            <g key={`front-${f.properties.kind}-${i}`}>
              <path
                d={lineToSmoothPath(f.geometry.coordinates, bounds)}
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
                    f.properties.kind === "warm_front" ? "#ef4444" : stroke.color
                  }
                  stroke={
                    f.properties.kind === "warm_front" ? "#ffffff" : stroke.color
                  }
                  strokeWidth={
                    f.properties.kind === "warm_front" ? 0.4 : 0.55
                  }
                  strokeLinejoin="round"
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
        const { x, y } = lonLatToBoundsPct(lon, lat, bounds);
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
      key={frame?.stamp ?? "latest"}
      data={geojson as GeoJSON.FeatureCollection}
      style={leafletStyle}
      pointToLayer={pointToLayer}
      pathOptions={{ opacity }}
    />
  );
}
