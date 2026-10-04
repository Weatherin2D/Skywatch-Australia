"use client";

import { Fragment, useEffect } from "react";
import { CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import type { StormCell } from "@/lib/weather/storm-cell-types";

export function StormCellOverlay({
  cells,
  enabled,
  selectedId,
  focusId,
}: {
  cells: StormCell[];
  enabled: boolean;
  selectedId?: string | null;
  focusId?: string | null;
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
        const color =
          cell.strength >= 0.65
            ? "#f97316"
            : cell.strength >= 0.4
              ? "#fbbf24"
              : "#22d3ee";
        const track = cell.track.map(
          (p) => [p.lat, p.lon] as [number, number],
        );
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
            <CircleMarker
              center={[cell.lat, cell.lon]}
              radius={selected ? 12 : 8 + cell.strength * 6}
              pathOptions={{
                color: "#fff",
                weight: selected ? 2.5 : 1.5,
                fillColor: color,
                fillOpacity: 0.55 + cell.strength * 0.3,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <span className="text-xs font-semibold">
                  {cell.label} · {cell.ratePerMin}/min
                  {cell.speedKmh != null
                    ? ` · ${Math.round(cell.speedKmh)} km/h`
                    : ""}
                </span>
              </Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}
    </>
  );
}
