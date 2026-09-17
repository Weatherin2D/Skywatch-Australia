"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
  filterStrikesAtTime,
  lightningAgeGradientCss,
  strikeAgeColor,
  strikeAgeSeconds,
  strikeAgeSize,
  strikeIsFresh,
} from "@/lib/weather/lightning";
import { lonLatToGibsPct } from "@/lib/weather/maps";

function useNowTick(enabled: boolean) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function useReferenceTime(
  enabled: boolean,
  referenceTime: number | null | undefined,
) {
  const now = useNowTick(enabled && referenceTime == null);
  return referenceTime ?? now;
}

function CrosshairIcon({
  color,
  size,
  pulse,
}: {
  color: string;
  size: number;
  pulse?: boolean;
}) {
  const arm = Math.max(4, Math.round(size * 0.4));
  const gap = Math.max(2, Math.round(size * 0.12));
  const thick = Math.max(2, size * 0.14);
  return (
    <span
      className={
        pulse
          ? "skywatch-lightning-crosshair skywatch-lightning-crosshair--new relative block"
          : "skywatch-lightning-crosshair relative block"
      }
      style={
        {
          width: size,
          height: size,
          color,
          ["--lg-arm" as string]: `${arm}px`,
          ["--lg-gap" as string]: `${gap}px`,
          ["--lg-thick" as string]: `${thick}px`,
        } as CSSProperties
      }
      aria-hidden
    >
      <i />
      <b />
    </span>
  );
}

function crosshairHtml(color: string, size: number, pulse: boolean) {
  const arm = Math.max(4, Math.round(size * 0.4));
  const gap = Math.max(2, Math.round(size * 0.12));
  const thick = Math.max(2, size * 0.14);
  const cls = pulse
    ? "skywatch-lightning-crosshair skywatch-lightning-crosshair--new"
    : "skywatch-lightning-crosshair";
  return `<span class="${cls}" style="width:${size}px;height:${size}px;color:${color};--lg-arm:${arm}px;--lg-gap:${gap}px;--lg-thick:${thick}px"><i></i><b></b></span>`;
}

function makeCrosshairIcon(color: string, size: number, pulse: boolean) {
  return L.divIcon({
    className: "skywatch-lightning-marker",
    html: crosshairHtml(color, size, pulse),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Satellite-frame lightning crosshairs, aged vs active frame time. */
export function SatelliteLightningOverlay({
  strikes,
  enabled,
  referenceTime = null,
}: {
  strikes: LightningStrike[];
  enabled: boolean;
  referenceTime?: number | null;
}) {
  const refTime = useReferenceTime(enabled, referenceTime);
  const visible = useMemo(() => {
    if (!enabled) return [];
    // Always age against wall clock — satellite scrub must not hide live strikes.
    return filterStrikesAtTime(strikes, refTime, 60);
  }, [enabled, strikes, refTime]);

  if (!enabled || visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[40] overflow-hidden">
      {visible.map((strike) => {
        const age = strikeAgeSeconds(strike, refTime);
        const color = strikeAgeColor(age);
        const size = strikeAgeSize(age);
        const { x, y } = lonLatToGibsPct(strike.lon, strike.lat);
        return (
          <span
            key={strike.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <CrosshairIcon
              color={color}
              size={size}
              pulse={strikeIsFresh(age)}
            />
          </span>
        );
      })}
    </div>
  );
}

/** Leaflet lightning crosshairs for Map / Radar views. */
export function LeafletLightningOverlay({
  strikes,
  enabled,
  referenceTime = null,
}: {
  strikes: LightningStrike[];
  enabled: boolean;
  referenceTime?: number | null;
}) {
  const refTime = useReferenceTime(enabled, referenceTime);
  const visible = useMemo(() => {
    if (!enabled) return [];
    return filterStrikesAtTime(strikes, refTime, 60).slice(0, 400);
  }, [enabled, strikes, refTime]);

  if (!enabled) return null;

  return (
    <>
      {visible.map((strike) => {
        const age = strikeAgeSeconds(strike, refTime);
        const color = strikeAgeColor(age);
        const size = strikeAgeSize(age);
        return (
          <Marker
            key={`${strike.id}-${color}-${size}`}
            position={[strike.lat, strike.lon]}
            icon={makeCrosshairIcon(color, size, strikeIsFresh(age))}
            interactive
          >
            <Tooltip direction="top" offset={[0, -6]}>
              Lightning · {Math.round(age / 60)} min ago
              {strike.polarity ? (strike.polarity > 0 ? " · +" : " · −") : ""}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

export function LightningLegend({
  strikes,
  attribution,
  status,
  live,
  referenceTime = null,
  frameSynced = false,
}: {
  strikes: LightningStrike[];
  attribution?: string | null;
  status?: "connecting" | "live" | "reconnecting" | "error" | null;
  live?: boolean;
  referenceTime?: number | null;
  frameSynced?: boolean;
}) {
  const refTime = referenceTime ?? Math.floor(Date.now() / 1000);
  const visible = filterStrikesAtTime(strikes, refTime, 60);

  const statusLabel =
    status === "live"
      ? "LIVE"
      : status === "reconnecting"
        ? "RECONNECTING"
        : status === "connecting"
          ? "CONNECTING"
          : status === "error"
            ? "OFFLINE"
            : live
              ? "LIVE"
              : "…";

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] border border-white/25 bg-black/70 px-2.5 py-2 text-white backdrop-blur-sm">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--bom-yellow)]">
          Lightning tracker
        </p>
        <span
          className={
            status === "live"
              ? "rounded-sm bg-emerald-500/90 px-1 py-px text-[8px] font-bold tracking-wide text-black"
              : status === "error"
                ? "rounded-sm bg-red-500/90 px-1 py-px text-[8px] font-bold tracking-wide text-white"
                : "rounded-sm bg-amber-400/90 px-1 py-px text-[8px] font-bold tracking-wide text-black"
          }
        >
          {statusLabel}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="mb-2 max-w-[12rem] text-[10px] leading-snug text-white/75">
          {status === "live" || status === "reconnecting"
            ? "No strikes over Australia in the last 60 min — listening live…"
            : "Connecting to live lightning feed…"}
        </p>
      ) : null}
      <div className="w-[11.5rem]">
        <div
          className="h-2 w-full border border-white/20"
          style={{ background: lightningAgeGradientCss() }}
          aria-label="Lightning age colour scale from new to 60 minutes"
        />
        <div className="mt-1 flex justify-between text-[9px] text-white/75">
          <span>New</span>
          <span>60 min</span>
        </div>
      </div>
      <p className="mt-1.5 text-[9px] text-white/60">
        {visible.length} strikes · last 60 min
      </p>
      {attribution ? (
        <p className="mt-0.5 max-w-[12rem] text-[8px] leading-snug text-white/45">
          {attribution}
        </p>
      ) : null}
    </div>
  );
}
