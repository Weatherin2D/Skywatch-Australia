"use client";

import { Fragment, useEffect } from "react";
import {
  CircleMarker,
  Marker,
  Polyline,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { StormCell } from "@/lib/weather/storm-cell-types";

function scoreColor(score: number): string {
  if (score >= 75) return "#f97316";
  if (score >= 55) return "#fbbf24";
  return "#22d3ee";
}

function scoreIcon(score: number, selected: boolean): L.DivIcon {
  const color = scoreColor(score);
  return L.divIcon({
    className: "skywatch-cell-score",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      min-width:${selected ? 30 : 26}px;height:${selected ? 30 : 26}px;
      padding:0 4px;border-radius:999px;
      background:${color};color:#0a1224;
      border:2px solid ${selected ? "#fff" : "rgba(255,255,255,0.75)"};
      font:700 11px/1 ui-sans-serif,system-ui,sans-serif;
      box-shadow:0 1px 4px rgba(0,0,0,0.45);
    ">${score}</div>`,
    iconSize: [selected ? 30 : 26, selected ? 30 : 26],
    iconAnchor: [selected ? 15 : 13, selected ? 15 : 13],
  });
}

export function StormCellOverlay({
  cells,
  enabled,
  selectedId,
  focusId,
  onSelect,
}: {
  cells: StormCell[];
  enabled: boolean;
  selectedId?: string | null;
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !focusId) return;
    const cell = cells.find((c) => c.id === focusId);
    if (!cell) return;
    map.flyTo([cell.lat, cell.lon], Math.max(map.getZoom(), 6), {
      animate: true,
      duration: 0.8,
    });
  }, [enabled, focusId, cells, map]);

  if (!enabled || !cells.length) return null;

  return (
    <>
      {cells.map((cell) => {
        const selected = cell.id === selectedId;
        const color = scoreColor(cell.score);
        const track = cell.track.map(
          (p) => [p.lat, p.lon] as [number, number],
        );
        const projected = [
          [cell.lat, cell.lon] as [number, number],
          ...cell.projectedPath.map(
            (p) => [p.lat, p.lon] as [number, number],
          ),
        ];
        return (
          <Fragment key={cell.id}>
            {track.length >= 2 ? (
              <Polyline
                positions={track}
                pathOptions={{
                  color,
                  weight: selected ? 3 : 2,
                  opacity: selected ? 0.9 : 0.55,
                  dashArray: "4 6",
                }}
              />
            ) : null}
            {projected.length >= 2 ? (
              <Polyline
                positions={projected}
                pathOptions={{
                  color: "#f472b6",
                  weight: selected ? 3 : 2,
                  opacity: selected ? 0.95 : 0.7,
                  dashArray: "8 5",
                }}
              />
            ) : null}
            <CircleMarker
              center={[cell.lat, cell.lon]}
              radius={selected ? 14 : 9 + cell.score / 20}
              pathOptions={{
                color: "#fff",
                weight: selected ? 2.5 : 1.5,
                fillColor: color,
                fillOpacity: 0.35,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelect?.(selected ? null : cell.id);
                },
              }}
            />
            <Marker
              position={[cell.lat, cell.lon]}
              icon={scoreIcon(cell.score, selected)}
              zIndexOffset={selected ? 600 : 400}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelect?.(selected ? null : cell.id);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -14]}>
                <span className="text-xs font-semibold">
                  {cell.score}/100 · {cell.label}
                  {cell.alertLevel !== "none"
                    ? ` · ${cell.alertLevel}`
                    : ""}
                </span>
              </Tooltip>
            </Marker>
          </Fragment>
        );
      })}
    </>
  );
}
