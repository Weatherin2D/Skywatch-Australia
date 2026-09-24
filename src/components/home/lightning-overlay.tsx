"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
  alignStrikesToTimeline,
  filterStrikesAtTime,
  LIGHTNING_VISIBLE_WINDOW_SEC,
  lightningAgeGradientCss,
  sampleStrikesForDisplay,
  shouldAlignStrikesToTimeline,
  strikeAgeColor,
  strikeAgeSeconds,
  strikeAgeSize,
  strikeIsFresh,
} from "@/lib/weather/lightning";
import { lonLatToGibsPct } from "@/lib/weather/maps";

/**
 * Drop strike icons once they are older than 3h relative to the active frame.
 * As the loop plays forward, aged-out strokes disappear from that frame on.
 */
const FRAME_LOOKBACK_MIN = Math.round(LIGHTNING_VISIBLE_WINDOW_SEC / 60);
/** Hard cap — thousands of DOM markers freeze the map; sample spatially. */
const MAX_VISIBLE_STRIKES = 900;

function strikesForReference(
  strikes: LightningStrike[],
  refTime: number,
  timelineStart: number | null | undefined,
  timelineEnd: number | null | undefined,
) {
  let working = strikes;

  if (
    timelineStart != null &&
    timelineEnd != null &&
    timelineEnd > timelineStart &&
    strikes.length > 0
  ) {
    let dataStart = Infinity;
    let dataEnd = -Infinity;
    for (const s of strikes) {
      if (s.time < dataStart) dataStart = s.time;
      if (s.time > dataEnd) dataEnd = s.time;
    }

    // Live-only buffers often share nearly identical timestamps; nudge so
    // alignStrikesToTimeline can stretch them across the IR loop.
    if (!(dataEnd > dataStart)) {
      working = strikes.map((s, i) => ({
        ...s,
        time: dataStart - (strikes.length - 1 - i) * 45,
      }));
    }

    // Align onto the satellite loop only — never into a long pre-loop window,
    // which froze nearly the full marker field on frame 1.
    if (shouldAlignStrikesToTimeline(working, timelineStart, timelineEnd)) {
      working = alignStrikesToTimeline(working, timelineStart, timelineEnd);
    }
  }

  let visible = filterStrikesAtTime(working, refTime, FRAME_LOOKBACK_MIN);

  // Safety net: if frame sync filtered everything (e.g. timeline props missing
  // while the active frame is older than live strikes), still show recent hits.
  if (visible.length === 0 && strikes.length > 0) {
    const wall = Math.floor(Date.now() / 1000);
    visible = filterStrikesAtTime(
      strikes,
      Math.max(refTime, wall),
      FRAME_LOOKBACK_MIN,
    );
  }

  return sampleStrikesForDisplay(visible, MAX_VISIBLE_STRIKES, refTime);
}

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
  timelineStart = null,
  timelineEnd = null,
}: {
  strikes: LightningStrike[];
  enabled: boolean;
  referenceTime?: number | null;
  /** Oldest satellite frame time — used to stretch history across the loop. */
  timelineStart?: number | null;
  /** Newest satellite frame time. */
  timelineEnd?: number | null;
}) {
  const refTime = useReferenceTime(enabled, referenceTime);
  const visible = useMemo(() => {
    if (!enabled) return [];
    return strikesForReference(
      strikes,
      refTime,
      timelineStart,
      timelineEnd,
    );
  }, [enabled, strikes, refTime, timelineStart, timelineEnd]);

  if (!enabled || visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[50] overflow-hidden">
      {visible.map((strike, index) => {
        const age = strikeAgeSeconds(strike, refTime);
        const color = strikeAgeColor(age);
        const size = strikeAgeSize(age);
        const { x, y } = lonLatToGibsPct(strike.lon, strike.lat);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return (
          <span
            key={strike.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <CrosshairIcon
              color={color}
              size={size}
              pulse={index < 12 && strikeIsFresh(age)}
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
  timelineStart = null,
  timelineEnd = null,
}: {
  strikes: LightningStrike[];
  enabled: boolean;
  referenceTime?: number | null;
  timelineStart?: number | null;
  timelineEnd?: number | null;
}) {
  const refTime = useReferenceTime(enabled, referenceTime);
  const visible = useMemo(() => {
    if (!enabled) return [];
    return strikesForReference(
      strikes,
      refTime,
      timelineStart,
      timelineEnd,
    );
  }, [enabled, strikes, refTime, timelineStart, timelineEnd]);

  if (!enabled) return null;

  return (
    <>
      {visible.map((strike, index) => {
        const age = strikeAgeSeconds(strike, refTime);
        const color = strikeAgeColor(age);
        const size = strikeAgeSize(age);
        return (
          <Marker
            key={strike.id}
            position={[strike.lat, strike.lon]}
            icon={makeCrosshairIcon(
              color,
              size,
              index < 12 && strikeIsFresh(age),
            )}
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
  timelineStart = null,
  timelineEnd = null,
}: {
  strikes: LightningStrike[];
  attribution?: string | null;
  status?: "connecting" | "live" | "reconnecting" | "error" | null;
  live?: boolean;
  referenceTime?: number | null;
  frameSynced?: boolean;
  timelineStart?: number | null;
  timelineEnd?: number | null;
}) {
  const refTime = referenceTime ?? Math.floor(Date.now() / 1000);
  const visible = strikesForReference(
    strikes,
    refTime,
    frameSynced ? timelineStart : null,
    frameSynced ? timelineEnd : null,
  );
  const visibleLabelHours = Math.round(LIGHTNING_VISIBLE_WINDOW_SEC / 3600);

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
            ? frameSynced && referenceTime != null
              ? "No strikes at this frame time — play the loop as storms develop…"
              : `No strikes over Australia in the last ${visibleLabelHours}h — listening live…`
            : "Connecting to live lightning feed…"}
        </p>
      ) : null}
      <div className="w-[11.5rem]">
        <div
          className="h-2 w-full border border-white/20"
          style={{ background: lightningAgeGradientCss() }}
          aria-label={`Lightning age colour scale from new to ${visibleLabelHours} hours`}
        />
        <div className="mt-1 flex justify-between text-[9px] text-white/75">
          <span>New</span>
          <span>{visibleLabelHours}h</span>
        </div>
      </div>
      <p className="mt-1.5 text-[9px] text-white/60">
        {visible.length} strikes ·{" "}
        {frameSynced && referenceTime != null
          ? "synced to satellite frame"
          : `last ${visibleLabelHours}h`}
      </p>
      {attribution ? (
        <p className="mt-0.5 max-w-[12rem] text-[8px] leading-snug text-white/45">
          {attribution}
        </p>
      ) : null}
    </div>
  );
}
