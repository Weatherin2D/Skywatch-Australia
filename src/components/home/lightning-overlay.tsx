"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
  LIGHTNING_VISIBLE_WINDOW_SEC,
  lightningAgeGradientCss,
  strikeAgeColor,
  strikeAgeSeconds,
  strikeAgeSize,
  strikeIsFresh,
  strikeOpacity,
  strikesForAnimation,
} from "@/lib/weather/lightning";
import { lonLatToGibsPct } from "@/lib/weather/maps";

/**
 * Windy-style animation clock.
 * While playing, smoothly advances from the current frame time toward the next
 * so strikes flash/fade continuously instead of only snapping on frame changes.
 * When paused/scrubbed, locks to the discrete frame time.
 */
function useWindyAnimTime(
  enabled: boolean,
  referenceTime: number | null | undefined,
  playing: boolean,
  msPerFrame: number,
  nextFrameTime: number | null | undefined,
) {
  const wall = useNowTick(enabled && referenceTime == null);
  const base = referenceTime ?? wall;
  const [animTime, setAnimTime] = useState(base);
  const baseRef = useRef(base);
  const nextRef = useRef(nextFrameTime);
  const playingRef = useRef(playing);
  const msRef = useRef(msPerFrame);
  baseRef.current = base;
  nextRef.current = nextFrameTime;
  playingRef.current = playing;
  msRef.current = msPerFrame;

  useEffect(() => {
    if (!enabled) return;

    if (!playing || referenceTime == null) {
      setAnimTime(base);
      return;
    }

    const from = base;
    const to =
      nextFrameTime != null && nextFrameTime > from
        ? nextFrameTime
        : from + Math.max(60, Math.round(msPerFrame / 10));
    const started = performance.now();
    const duration = Math.max(80, msPerFrame);
    let raf = 0;

    const tick = (now: number) => {
      if (!playingRef.current) {
        setAnimTime(baseRef.current);
        return;
      }
      const u = Math.min(1, (now - started) / duration);
      // Ease slightly so flashes bunch near frame boundaries less harshly.
      const eased = u * u * (3 - 2 * u);
      setAnimTime(Math.round(from + (to - from) * eased));
      if (u < 1) raf = requestAnimationFrame(tick);
    };

    setAnimTime(from);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    enabled,
    playing,
    referenceTime,
    base,
    nextFrameTime,
    msPerFrame,
  ]);

  return animTime;
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

function CrosshairIcon({
  color,
  size,
  pulse,
  opacity,
}: {
  color: string;
  size: number;
  pulse?: boolean;
  opacity: number;
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
          opacity,
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

function crosshairHtml(
  color: string,
  size: number,
  pulse: boolean,
  opacity: number,
) {
  const arm = Math.max(4, Math.round(size * 0.4));
  const gap = Math.max(2, Math.round(size * 0.12));
  const thick = Math.max(2, size * 0.14);
  const cls = pulse
    ? "skywatch-lightning-crosshair skywatch-lightning-crosshair--new"
    : "skywatch-lightning-crosshair";
  return `<span class="${cls}" style="width:${size}px;height:${size}px;color:${color};opacity:${opacity};--lg-arm:${arm}px;--lg-gap:${gap}px;--lg-thick:${thick}px"><i></i><b></b></span>`;
}

function makeCrosshairIcon(
  color: string,
  size: number,
  pulse: boolean,
  opacity: number,
) {
  return L.divIcon({
    className: "skywatch-lightning-marker",
    html: crosshairHtml(color, size, pulse, opacity),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

type LightningAnimProps = {
  strikes: LightningStrike[];
  enabled: boolean;
  referenceTime?: number | null;
  timelineStart?: number | null;
  timelineEnd?: number | null;
  /** Satellite loop is playing — drive continuous Windy-style clock. */
  playing?: boolean;
  msPerFrame?: number;
  /** Unix time of the next loop frame (for inter-frame interpolation). */
  nextFrameTime?: number | null;
};

/** Satellite-frame lightning — Windy trail + our crosshairs / age colours. */
export function SatelliteLightningOverlay({
  strikes,
  enabled,
  referenceTime = null,
  timelineStart = null,
  timelineEnd = null,
  playing = false,
  msPerFrame = 500,
  nextFrameTime = null,
}: LightningAnimProps) {
  const animTime = useWindyAnimTime(
    enabled,
    referenceTime,
    playing,
    msPerFrame,
    nextFrameTime,
  );
  const visible = useMemo(() => {
    if (!enabled) return [];
    return strikesForAnimation(
      strikes,
      animTime,
      timelineStart,
      timelineEnd,
    );
  }, [enabled, strikes, animTime, timelineStart, timelineEnd]);

  if (!enabled || visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[50] overflow-hidden">
      {visible.map((strike, index) => {
        const age = strikeAgeSeconds(strike, animTime);
        const opacity = strikeOpacity(age);
        if (opacity <= 0.02) return null;
        const color = strikeAgeColor(age);
        const size = strikeAgeSize(age);
        const { x, y } = lonLatToGibsPct(strike.lon, strike.lat);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return (
          <span
            key={strike.id}
            className="skywatch-lightning-strike absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <CrosshairIcon
              color={color}
              size={size}
              opacity={opacity}
              pulse={index < 16 && strikeIsFresh(age)}
            />
          </span>
        );
      })}
    </div>
  );
}

/** Leaflet lightning — same Windy trail model for Map / Radar views. */
export function LeafletLightningOverlay({
  strikes,
  enabled,
  referenceTime = null,
  timelineStart = null,
  timelineEnd = null,
  playing = false,
  msPerFrame = 500,
  nextFrameTime = null,
}: LightningAnimProps) {
  const animTime = useWindyAnimTime(
    enabled,
    referenceTime,
    playing,
    msPerFrame,
    nextFrameTime,
  );
  const visible = useMemo(() => {
    if (!enabled) return [];
    return strikesForAnimation(
      strikes,
      animTime,
      timelineStart,
      timelineEnd,
    );
  }, [enabled, strikes, animTime, timelineStart, timelineEnd]);

  if (!enabled) return null;

  return (
    <>
      {visible.map((strike, index) => {
        const age = strikeAgeSeconds(strike, animTime);
        const opacity = strikeOpacity(age);
        if (opacity <= 0.02) return null;
        const color = strikeAgeColor(age);
        const size = strikeAgeSize(age);
        return (
          <Marker
            key={strike.id}
            position={[strike.lat, strike.lon]}
            opacity={opacity}
            icon={makeCrosshairIcon(
              color,
              size,
              index < 16 && strikeIsFresh(age),
              opacity,
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
  playing = false,
  msPerFrame = 500,
  nextFrameTime = null,
}: {
  strikes: LightningStrike[];
  attribution?: string | null;
  status?: "connecting" | "live" | "reconnecting" | "error" | null;
  live?: boolean;
  referenceTime?: number | null;
  frameSynced?: boolean;
  timelineStart?: number | null;
  timelineEnd?: number | null;
  playing?: boolean;
  msPerFrame?: number;
  nextFrameTime?: number | null;
}) {
  const animTime = useWindyAnimTime(
    true,
    frameSynced ? referenceTime : null,
    frameSynced && playing,
    msPerFrame,
    nextFrameTime,
  );
  const visible = strikesForAnimation(
    strikes,
    animTime,
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
              ? "No strikes in this trail window — play as storms develop…"
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
