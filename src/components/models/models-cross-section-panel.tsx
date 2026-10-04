"use client";

import type { CrossSectionPayload } from "@/lib/weather/cross-section";

function colorFor(field: string, t: number): string {
  const u = Math.max(0, Math.min(1, t));
  if (field === "rh") {
    const r = Math.round(20 + u * 40);
    const g = Math.round(60 + u * 140);
    const b = Math.round(120 + u * 100);
    return `rgb(${r},${g},${b})`;
  }
  if (field === "wind") {
    const r = Math.round(40 + u * 200);
    const g = Math.round(80 + (1 - u) * 100);
    const b = Math.round(180 - u * 120);
    return `rgb(${r},${g},${b})`;
  }
  // temperature: blue → cyan → yellow → red
  if (u < 0.33) {
    const k = u / 0.33;
    return `rgb(${Math.round(40 + k * 40)},${Math.round(90 + k * 120)},${Math.round(220 - k * 40)})`;
  }
  if (u < 0.66) {
    const k = (u - 0.33) / 0.33;
    return `rgb(${Math.round(80 + k * 160)},${Math.round(210 - k * 40)},${Math.round(180 - k * 140)})`;
  }
  const k = (u - 0.66) / 0.34;
  return `rgb(${Math.round(240)},${Math.round(170 - k * 120)},${Math.round(40)})`;
}

type Props = {
  data: CrossSectionPayload | null;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
};

export function ModelsCrossSectionPanel({
  data,
  loading,
  error,
  onClose,
}: Props) {
  if (loading) {
    return (
      <div className="sw-panel p-3 text-xs text-white/70">
        Building cross-section…
      </div>
    );
  }
  if (error) {
    return (
      <div className="sw-panel border border-red-400/30 p-3 text-xs text-white/85">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const vmin = data.min ?? 0;
  const vmax = data.max ?? 1;
  const span = vmax - vmin || 1;
  const nCols = data.columns.length;
  const nRows = data.pressures.length;
  const cellW = 28;
  const cellH = 18;
  const w = nCols * cellW + 48;
  const h = nRows * cellH + 28;

  return (
    <div className="sw-panel space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-white">
            Cross-section · {data.modelLabel} · {data.field} ({data.units})
          </p>
          <p className="text-[10px] text-white/50">
            {data.start.lat.toFixed(2)},{data.start.lon.toFixed(2)} →{" "}
            {data.end.lat.toFixed(2)},{data.end.lon.toFixed(2)}
            {data.time ? ` · ${data.time}` : ""}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-1.5 py-0.5 text-xs text-white/50 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-auto max-h-56 w-full min-w-[320px]"
          role="img"
          aria-label="Vertical cross-section heatmap"
        >
          {data.columns.map((col, ci) =>
            data.pressures.map((p, ri) => {
              const v = col.values[ri];
              const t = v == null ? null : (v - vmin) / span;
              const x = 40 + ci * cellW;
              const y = 8 + ri * cellH;
              return (
                <rect
                  key={`${ci}-${p}`}
                  x={x}
                  y={y}
                  width={cellW - 1}
                  height={cellH - 1}
                  fill={t == null ? "rgba(255,255,255,0.06)" : colorFor(data.field, t)}
                >
                  <title>
                    {p} hPa · {col.distanceKm} km ·{" "}
                    {v == null ? "—" : `${v.toFixed(1)} ${data.units}`}
                  </title>
                </rect>
              );
            }),
          )}
          {data.pressures.map((p, ri) => (
            <text
              key={`p-${p}`}
              x={36}
              y={8 + ri * cellH + cellH * 0.7}
              textAnchor="end"
              fill="rgba(255,255,255,0.55)"
              fontSize={9}
            >
              {p}
            </text>
          ))}
        </svg>
      </div>
      <p className="text-[10px] text-white/40">{data.attribution}</p>
    </div>
  );
}
