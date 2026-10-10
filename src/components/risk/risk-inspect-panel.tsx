"use client";

import { X } from "lucide-react";
import type { RiskAiThermo } from "@/lib/weather/risk-ai-thermo";
import { cn } from "@/lib/utils";

export type { RiskAiThermo };

export type RiskInspectPoint = {
  kind: "point";
  status: "ok" | "empty";
  source: string;
  product: string;
  day: number;
  lat: number;
  lon: number;
  distanceKm: number;
  category: {
    id: string;
    label: string;
    color: string;
    rank: number;
    hatch: 0 | 1 | 2;
    hatchLabel: string | null;
  };
  summary: string;
  reasons: string[];
  conditions: Array<{ label: string; value: string; hint?: string }>;
  hazards?: Array<{ id: string; label: string; pct: number }>;
  guidance: string;
  /** Optional CloudCountry AI / thermo overlay from sounding sidecar. */
  aiThermo?: RiskAiThermo | null;
};

export type RiskInspectCategory = {
  kind: "category";
  id: string;
  label: string;
  color: string;
  blurb: string;
  productLabel: string;
};

type Props = {
  loading?: boolean;
  error?: string | null;
  data: RiskInspectPoint | RiskInspectCategory | null;
  onClose: () => void;
};

export function RiskInspectPanel({ loading, error, data, onClose }: Props) {
  if (!loading && !error && !data) return null;

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-[540] sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-md">
      <div className="rounded-2xl border border-white/15 bg-[#0b1224]/92 p-3 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-md sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              {data?.kind === "category" ? "Category" : "Area inspect"}
            </p>
            {loading ? (
              <p className="mt-1 text-sm text-white/70">Reading conditions…</p>
            ) : error ? (
              <p className="mt-1 text-sm text-rose-300">{error}</p>
            ) : data?.kind === "category" ? (
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="h-4 w-7 shrink-0 border border-white/40"
                  style={{ backgroundColor: data.color }}
                  aria-hidden
                />
                <h3 className="truncate font-[family-name:var(--font-display)] text-lg font-bold text-white">
                  {data.label}
                </h3>
              </div>
            ) : data ? (
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="h-4 w-7 shrink-0 border border-white/40"
                  style={{ backgroundColor: data.category.color }}
                  aria-hidden
                />
                <h3 className="truncate font-[family-name:var(--font-display)] text-lg font-bold text-white">
                  {data.category.label}
                  {data.category.hatchLabel
                    ? ` · ${data.category.hatchLabel}`
                    : ""}
                </h3>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Close inspect panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!loading && !error && data?.kind === "category" ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm leading-relaxed text-white/75">{data.blurb}</p>
            <p className="text-[11px] text-white/40">
              {data.productLabel} · tap the map on a coloured area for local
              conditions
            </p>
          </div>
        ) : null}

        {!loading && !error && data?.kind === "point" ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm leading-relaxed text-white/80">{data.summary}</p>
            <p className="text-[11px] text-white/45">
              {data.lat.toFixed(2)}°, {data.lon.toFixed(2)}°
              {data.distanceKm > 0.5
                ? ` · nearest sample ${data.distanceKm.toFixed(0)} km away`
                : ""}
              {" · "}Day {data.day}
            </p>

            {data.reasons.length ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
                  Why this rating
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {data.reasons.map((r) => (
                    <li
                      key={r}
                      className="text-xs leading-relaxed text-white/70"
                    >
                      <span className="mr-1.5 text-[var(--cyan)]">›</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {data.conditions.length ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
                  Conditions
                </p>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {data.conditions.map((c) => (
                    <div key={c.label} className="min-w-0">
                      <dt className="text-[10px] uppercase tracking-wide text-white/40">
                        {c.label}
                      </dt>
                      <dd
                        className="truncate text-sm font-semibold text-white/90"
                        title={c.hint}
                      >
                        {c.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {data.hazards?.length ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
                  Hazard chances
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {data.hazards.map((h) => (
                    <li
                      key={h.id}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        h.pct >= 15
                          ? "border-[var(--cyan)]/40 bg-[var(--cyan)]/10 text-[var(--cyan)]"
                          : "border-white/10 bg-white/[0.04] text-white/55",
                      )}
                    >
                      {h.label} {Math.round(h.pct)}%
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {data.aiThermo?.conditions.length ? (
              <div
                className={cn(
                  "rounded-xl border px-2.5 py-2",
                  data.aiThermo.engine === "skywatch-ai-v1"
                    ? "border-amber-400/35 bg-amber-400/[0.07]"
                    : "border-[var(--cyan)]/30 bg-[var(--cyan)]/[0.06]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-wide",
                      data.aiThermo.engine === "skywatch-ai-v1"
                        ? "text-amber-200"
                        : "text-[var(--cyan)]",
                    )}
                  >
                    {data.aiThermo.label}
                  </p>
                  {data.aiThermo.soundingUrl ? (
                    <a
                      href={data.aiThermo.soundingUrl}
                      className="text-[11px] font-semibold text-white/70 hover:text-white"
                    >
                      Full sounding
                    </a>
                  ) : null}
                </div>
                {data.aiThermo.message ? (
                  <p className="mt-0.5 text-[10px] text-white/45">
                    {data.aiThermo.message}
                  </p>
                ) : null}
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {data.aiThermo.conditions.map((c) => (
                    <div key={c.label} className="min-w-0">
                      <dt className="text-[10px] uppercase tracking-wide text-white/40">
                        {c.label}
                      </dt>
                      <dd
                        className="truncate text-sm font-semibold text-white/90"
                        title={c.hint}
                      >
                        {c.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            <p className="text-[10px] leading-relaxed text-white/40">
              {data.guidance}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
