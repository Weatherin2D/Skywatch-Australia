"use client";

import { useEffect, useMemo, useState } from "react";
import { Crosshair, Navigation, Radio } from "lucide-react";
import type { StormCell } from "@/lib/weather/storm-cells";
import { bearingBetween, distanceKm } from "@/lib/weather/storm-cells";
import { useSavedPlace } from "@/hooks/use-saved-place";
import { cn } from "@/lib/utils";

function compass(deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8]!;
}

export function ChaseHud({
  cells,
  loading,
  selectedId,
  onSelect,
  enabled,
  onToggle,
}: {
  cells: StormCell[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { place } = useSavedPlace();
  const [notifyNear, setNotifyNear] = useState(false);
  const origin = useMemo(
    () => ({
      lat: place?.lat ?? -33.87,
      lon: place?.lon ?? 151.21,
      label: place ? `${place.name}, ${place.state}` : "Sydney, NSW",
    }),
    [place],
  );

  const ranked = useMemo(() => {
    return cells
      .map((c) => {
        const km = distanceKm(origin.lat, origin.lon, c.lat, c.lon);
        const bearing = bearingBetween(origin.lat, origin.lon, c.lat, c.lon);
        return { cell: c, km, bearing };
      })
      .sort((a, b) => a.km - b.km || b.cell.strength - a.cell.strength);
  }, [cells, origin]);

  // Optional browser notification when a strong cell is within 120 km.
  useEffect(() => {
    if (!notifyNear || typeof window === "undefined") return;
    if (typeof Notification === "undefined") return;
    const near = ranked.find((r) => r.km <= 120 && r.cell.strength >= 0.45);
    if (!near || Notification.permission !== "granted") return;
    const key = `chase-near-${near.cell.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    try {
      new Notification("SkyWatch chase alert", {
        body: `Strong cell near ${near.cell.label} — ${Math.round(near.km)} km ${compass(near.bearing)} of ${origin.label}`,
      });
    } catch {
      /* ignore */
    }
  }, [notifyNear, ranked, origin.label]);

  return (
    <section className="sw-panel space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cyan)]">
            Chase HUD
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-white">
            Cells of interest
          </h2>
          <p className="text-[11px] text-white/55">
            From {origin.label} · lightning-tracked guidance
          </p>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
            enabled
              ? "border-[var(--cyan)]/40 bg-[var(--cyan)]/20 text-[var(--cyan)]"
              : "border-white/15 text-white/65 hover:text-white",
          )}
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          {enabled ? "Chase on" : "Chase off"}
        </button>
      </div>

      {enabled ? (
        <>
          <label className="flex items-center gap-2 text-[11px] text-white/60">
            <input
              type="checkbox"
              checked={notifyNear}
              onChange={async (e) => {
                const next = e.target.checked;
                if (next && typeof Notification !== "undefined") {
                  if (Notification.permission === "default") {
                    await Notification.requestPermission();
                  }
                }
                setNotifyNear(next);
              }}
            />
            Notify when a strong cell is within 120 km
          </label>

          {loading && !cells.length ? (
            <p className="text-sm text-white/60">Scanning cells…</p>
          ) : null}
          {!loading && !ranked.length ? (
            <p className="text-sm text-white/70">
              No active lightning cells in the last 15 minutes.
            </p>
          ) : null}

          <ul className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
            {ranked.slice(0, 10).map(({ cell, km, bearing }) => {
              const active = cell.id === selectedId;
              return (
                <li key={cell.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(active ? null : cell.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition",
                      active
                        ? "bg-[var(--cyan)]/20 text-white"
                        : "bg-white/[0.03] text-white/80 hover:bg-white/[0.06]",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {cell.label}
                      </p>
                      <p className="text-[11px] text-white/55">
                        {cell.ratePerMin}/min · {cell.strikes15m} strikes
                        {cell.speedKmh != null
                          ? ` · moving ${compass(cell.motionDeg)} ${Math.round(cell.speedKmh)} km/h`
                          : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="inline-flex items-center gap-1 text-xs font-bold text-[var(--cyan)]">
                        <Navigation className="h-3 w-3" aria-hidden />
                        {Math.round(km)} km
                      </p>
                      <p className="text-[10px] text-white/45">
                        {compass(bearing)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="flex items-center gap-1 text-[10px] text-white/40">
            <Radio className="h-3 w-3" aria-hidden />
            SkyWatch guidance — not official BoM tracks
          </p>
        </>
      ) : (
        <p className="text-sm text-white/60">
          Turn Chase on to rank nearby lightning cells and focus the map.
        </p>
      )}
    </section>
  );
}
