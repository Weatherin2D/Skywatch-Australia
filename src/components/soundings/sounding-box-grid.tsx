"use client";

import type { SoundingBoxPayload } from "@/lib/weather/sounding-types";
import { SkewTChart } from "@/components/soundings/skew-t";
import { cn } from "@/lib/utils";

function fmtCape(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}`;
}

type Props = {
  box: SoundingBoxPayload;
  selectedKey: string | null;
  activeParcel?: "SFC" | "ML" | "MU";
  onSelect: (row: number, col: number) => void;
};

export function SoundingBoxGrid({
  box,
  selectedKey,
  activeParcel = "SFC",
  onSelect,
}: Props) {
  const sorted = [...box.cells].sort(
    (a, b) => a.row - b.row || a.col - b.col,
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-white">
            Model sounding box
          </p>
          <p className="text-[11px] text-white/45">
            3×3 · ±{box.spacingDeg}° around {box.placeLabel} · north up · click
            a cell for full diagnostics
          </p>
        </div>
        <p className="text-[11px] text-white/40">{box.attribution}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {sorted.map((cell) => {
          const key = `${cell.row}-${cell.col}`;
          const selected = selectedKey === key;
          const cape =
            cell.sounding.params.parcels.find((p) => p.id === activeParcel)
              ?.cape ?? cell.sounding.params.parcels[0]?.cape;
          const ok = cell.sounding.status === "ok" && cell.sounding.levels.length > 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(cell.row, cell.col)}
              className={cn(
                "overflow-hidden rounded-2xl border text-left transition",
                selected
                  ? "border-[var(--cyan)]/60 bg-[var(--cyan)]/10 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]"
                  : "border-white/10 bg-[#070b16] hover:border-white/25",
              )}
            >
              <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white">
                    {cell.label}
                  </p>
                  <p className="truncate font-mono text-[10px] text-white/45">
                    {Math.abs(cell.latitude).toFixed(2)}°
                    {cell.latitude < 0 ? "S" : "N"}{" "}
                    {Math.abs(cell.longitude).toFixed(2)}°
                    {cell.longitude < 0 ? "W" : "E"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-white/40">
                    {activeParcel} CAPE
                  </p>
                  <p
                    className={cn(
                      "font-mono text-sm font-bold tabular-nums",
                      (cape ?? 0) > 500
                        ? "text-amber-300"
                        : "text-[var(--cyan)]",
                    )}
                  >
                    {fmtCape(cape)}
                  </p>
                </div>
              </div>
              <div className="aspect-[4/3] w-full bg-[#070b16]">
                {ok ? (
                  <SkewTChart
                    levels={cell.sounding.levels}
                    parcelTraces={cell.sounding.parcelTraces}
                    activeParcel={activeParcel}
                    compact
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-white/40">
                    {cell.sounding.message ?? "No profile"}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
