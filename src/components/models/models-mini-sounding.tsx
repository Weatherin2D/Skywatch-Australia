"use client";

import Link from "next/link";
import { SkewTChart } from "@/components/soundings/skew-t";
import {
  engineModeLabel,
  type EngineUiMode,
} from "@/lib/weather/engine-mode";
import type { SoundingPayload } from "@/lib/weather/sounding-types";

type Props = {
  sounding: SoundingPayload | null;
  loading?: boolean;
  error?: string | null;
  lat: number;
  lon: number;
  model?: string;
  time?: string | null;
  engine?: EngineUiMode;
  onClose?: () => void;
};

export function ModelsMiniSounding({
  sounding,
  loading,
  error,
  lat,
  lon,
  model = "ifs",
  time,
  engine = "auto",
  onClose,
}: Props) {
  const qs = new URLSearchParams({
    mode: "model",
    model,
    engine,
    lat: lat.toFixed(3),
    lon: lon.toFixed(3),
  });
  if (time) qs.set("time", time);

  const engineBadge =
    sounding?.engine === "skywatch-ai-v1"
      ? "AI V1"
      : sounding?.engine === "skywatch-ai"
        ? "Engine"
        : engine === "predict"
          ? "Experimental"
          : engine === "legacy"
            ? "Original"
            : null;

  return (
    <div className="absolute bottom-3 right-3 z-[500] w-[min(280px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/15 bg-[#0a1224]/94 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--cyan)]">
            Atmosphere profile
            {engineBadge ? (
              <span
                className={
                  engineBadge === "AI V1"
                    ? "ml-1.5 text-amber-300"
                    : "ml-1.5 text-white/45"
                }
              >
                · {engineBadge}
              </span>
            ) : null}
          </p>
          <p className="text-[11px] text-white/55">
            {lat.toFixed(2)}°, {lon.toFixed(2)}°
            {sounding?.engineMessage
              ? ` · ${engineModeLabel(engine)}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/soundings?${qs}`}
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--cyan)] hover:bg-white/10"
          >
            Full
          </Link>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-1.5 py-0.5 text-xs text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Close sounding"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>
      <div className="px-2 py-1">
        {loading ? (
          <p className="px-1 py-6 text-center text-xs text-white/55">
            Loading sounding…
          </p>
        ) : error ? (
          <p className="px-1 py-6 text-center text-xs text-red-300/90">{error}</p>
        ) : sounding?.status === "ok" && sounding.levels.length ? (
          <div className="mx-auto max-h-[220px] overflow-hidden">
            <SkewTChart
              levels={sounding.levels}
              parcelTraces={sounding.parcelTraces}
              compact
            />
          </div>
        ) : (
          <p className="px-1 py-6 text-center text-xs text-white/55">
            {sounding?.message ?? "No sounding levels"}
          </p>
        )}
      </div>
    </div>
  );
}
