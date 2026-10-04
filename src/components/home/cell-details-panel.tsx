"use client";

import Link from "next/link";
import { X } from "lucide-react";
import {
  compassLabel,
  type StormCell,
} from "@/lib/weather/storm-cell-types";
import { cn } from "@/lib/utils";

function levelStyles(level: StormCell["alertLevel"]) {
  if (level === "warning") {
    return "bg-orange-500/20 text-orange-200 border-orange-400/40";
  }
  if (level === "watch") {
    return "bg-amber-400/15 text-amber-100 border-amber-300/35";
  }
  return "bg-white/10 text-white/70 border-white/15";
}

export function CellDetailsPanel({
  cell,
  onClose,
}: {
  cell: StormCell | null;
  onClose?: () => void;
}) {
  if (!cell) return null;

  const pathHint =
    cell.projectedPath.length > 0
      ? `Projected ${cell.projectedPath.map((p) => `+${p.minutesAhead}m`).join(" · ")}`
      : "No projected path (motion uncertain)";

  return (
    <section className="sw-panel space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cyan)]">
            Cell details
          </p>
          <h2 className="mt-0.5 font-[family-name:var(--font-display)] text-lg font-bold text-white">
            {cell.label}
          </h2>
          <p className="text-[11px] text-white/55">
            {cell.lat.toFixed(2)}°, {cell.lon.toFixed(2)}°
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              levelStyles(cell.alertLevel),
            )}
          >
            {cell.alertLevel === "none" ? "cell" : cell.alertLevel}
          </span>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Close cell details"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex items-end gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
            Cell score
          </p>
          <p className="font-[family-name:var(--font-display)] text-3xl font-extrabold text-white">
            {cell.score}
            <span className="text-base font-semibold text-white/45">/100</span>
          </p>
        </div>
        <div className="min-w-0 flex-1 space-y-0.5 text-[11px] text-white/65">
          <p>
            {cell.ratePerMin}/min · {cell.strikes15m} strikes (15m) ·{" "}
            {cell.strikes45m} (45m)
          </p>
          <p>
            {cell.speedKmh != null
              ? `Moving ${compassLabel(cell.motionDeg)} ~${Math.round(cell.speedKmh)} km/h`
              : "Motion uncertain"}
          </p>
          <p className="text-white/50">{pathHint}</p>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/45">
          Analysis
        </p>
        <ul className="space-y-1.5">
          {cell.analysis.map((line) => (
            <li
              key={line}
              className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/80"
            >
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/warnings/auto/${encodeURIComponent(cell.id)}`}
          className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-white/90 hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)]"
        >
          Open automated alert
        </Link>
        <Link
          href={`/radar?chase=1&cell=${encodeURIComponent(cell.id)}`}
          className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white"
        >
          Focus on radar
        </Link>
      </div>

      <p className="text-[10px] text-white/40">
        SkyWatch lightning-tracked guidance — not an official BoM warning.
      </p>
    </section>
  );
}
