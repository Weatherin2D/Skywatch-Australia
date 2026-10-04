"use client";

type Props = {
  times: string[];
  values: (number | null)[];
  units: string;
  label: string;
  activeTime?: string | null;
};

export function ModelsMeteogram({
  times,
  values,
  units,
  label,
  activeTime,
}: Props) {
  const nums = values.filter((v): v is number => v != null);
  if (!times.length || !nums.length) {
    return (
      <div className="sw-panel px-3 py-2 text-xs text-white/55">
        Meteogram unavailable for this point.
      </div>
    );
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const w = 640;
  const h = 72;
  const pad = 6;
  const pts = values
    .map((v, i) => {
      if (v == null) return null;
      const x = pad + (i / Math.max(1, times.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  const activeIdx = activeTime ? times.indexOf(activeTime) : -1;
  const activeX =
    activeIdx >= 0
      ? pad + (activeIdx / Math.max(1, times.length - 1)) * (w - pad * 2)
      : null;

  return (
    <div className="sw-panel space-y-1 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-white">
          Meteogram · {label}
        </p>
        <p className="text-[10px] text-white/45">
          {min.toFixed(1)}–{max.toFixed(1)} {units}
        </p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" aria-hidden>
        {activeX != null ? (
          <line
            x1={activeX}
            x2={activeX}
            y1={0}
            y2={h}
            stroke="rgba(34,211,238,0.45)"
            strokeWidth={2}
          />
        ) : null}
        <polyline
          fill="none"
          stroke="rgba(34,211,238,0.9)"
          strokeWidth={2}
          points={pts}
        />
      </svg>
    </div>
  );
}
