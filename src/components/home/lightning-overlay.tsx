"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
  LIGHTNING_MAX_VISIBLE,
  LIGHTNING_MAX_VISIBLE_DOM,
  strikeAgeColor,
  strikeAgeRgb,
  strikeAgeSeconds,
  strikeAgeSize,
  strikeIsFresh,
  strikeOpacity,
  strikesForAnimation,
} from "@/lib/weather/lightning";
import { lonLatToBoundsPct, type LonLatBounds } from "@/lib/weather/maps";

export type LightningIconStyle = "crosshair" | "bolt";

type LightningAnimProps = {
  strikes: LightningStrike[];
  enabled: boolean;
  referenceTime?: number | null;
  timelineStart?: number | null;
  timelineEnd?: number | null;
  playing?: boolean;
  msPerFrame?: number;
  nextFrameTime?: number | null;
  /** Image georeference; defaults to national AU Himawari crop. */
  bounds?: LonLatBounds;
  iconStyle?: LightningIconStyle;
};

function useNowTick(enabled: boolean) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 2500);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

/** Discrete animation clock — updates on frame change, not every rAF. */
function useFrameAnimTime(
  enabled: boolean,
  referenceTime: number | null | undefined,
) {
  const wall = useNowTick(enabled && referenceTime == null);
  return referenceTime ?? wall;
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  r: number,
  g: number,
  b: number,
  opacity: number,
) {
  const s = Math.max(12, size);
  const half = s / 2;
  const gap = Math.max(1.2, s * 0.14);
  const thick = Math.max(1.4, s * 0.18);
  const arm = half - gap;
  if (arm <= 0.25) return;

  ctx.globalAlpha = opacity;
  ctx.strokeStyle = `rgb(${r},${g},${b})`;
  ctx.lineWidth = thick;
  ctx.lineCap = "butt";

  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx, cy - gap);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + gap);
  ctx.lineTo(cx, cy + half);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - half, cy);
  ctx.lineTo(cx - gap, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + gap, cy);
  ctx.lineTo(cx + half, cy);
  ctx.stroke();
}

/** Classic filled lightning bolt glyph, centred on (cx, cy). */
function drawBolt(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  r: number,
  g: number,
  b: number,
  opacity: number,
) {
  // Enforce a readable minimum so bolts never collapse to pin-dots.
  const s = Math.max(18, size);
  // Soft glow disc so strikes pop on dark IR / bright cloud tops.
  ctx.globalAlpha = opacity * 0.28;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = opacity;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.beginPath();
  // Wide zigzag bolt (⚡) — reads clearly at national scale.
  ctx.moveTo(cx + s * 0.08, cy - s * 0.58);
  ctx.lineTo(cx - s * 0.32, cy + s * 0.02);
  ctx.lineTo(cx - s * 0.06, cy + s * 0.02);
  ctx.lineTo(cx - s * 0.22, cy + s * 0.58);
  ctx.lineTo(cx + s * 0.36, cy - s * 0.06);
  ctx.lineTo(cx + s * 0.1, cy - s * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = Math.min(1, opacity * 0.9);
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = Math.max(1.2, s * 0.09);
  ctx.stroke();
}

/**
 * Satellite lightning on a single canvas (Windy-style).
 * Paints in rAF while playing — no React re-render per tick.
 * Snaps and repaints on every discrete frame when scrubbing.
 */
export function SatelliteLightningOverlay({
  strikes,
  enabled,
  referenceTime = null,
  timelineStart = null,
  timelineEnd = null,
  playing = false,
  msPerFrame = 500,
  nextFrameTime = null,
  bounds,
  iconStyle = "crosshair",
}: LightningAnimProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(0);

  const strikesRef = useRef(strikes);
  const timelineStartRef = useRef(timelineStart);
  const timelineEndRef = useRef(timelineEnd);
  const boundsRef = useRef(bounds);
  const iconStyleRef = useRef(iconStyle);
  strikesRef.current = strikes;
  timelineStartRef.current = timelineStart;
  timelineEndRef.current = timelineEnd;
  boundsRef.current = bounds;
  iconStyleRef.current = iconStyle;

  const paint = useRef((animTime: number) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return 0;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW < 2 || cssH < 2) return 0;

    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const visible = strikesForAnimation(
      strikesRef.current,
      animTime,
      timelineStartRef.current,
      timelineEndRef.current,
      LIGHTNING_MAX_VISIBLE,
    );

    const draw =
      iconStyleRef.current === "bolt" ? drawBolt : drawCrosshair;

    // Oldest first so fresh flashes paint on top.
    for (let i = visible.length - 1; i >= 0; i--) {
      const strike = visible[i]!;
      const age = strikeAgeSeconds(strike, animTime);
      const opacity = strikeOpacity(age);
      if (opacity <= 0.03) continue;
      const { x, y } = lonLatToBoundsPct(
        strike.lon,
        strike.lat,
        boundsRef.current,
      );
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < -5 || x > 105 || y < -5 || y > 105) continue;
      const { r, g, b } = strikeAgeRgb(age);
      const size = strikeAgeSize(age);
      const fresh = strikeIsFresh(age);
      const pulse = fresh ? 1 + 0.12 * Math.sin(animTime * 8 + i) : 1;
      draw(
        ctx,
        (x / 100) * cssW,
        (y / 100) * cssH,
        size * pulse,
        r,
        g,
        b,
        opacity,
      );
    }
    return visible.length;
  }).current;

  // Scrub / pause: repaint whenever the active frame time changes.
  useEffect(() => {
    if (!enabled) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      setCount(0);
      return;
    }
    if (playing) return;
    const t = referenceTime ?? Math.floor(Date.now() / 1000);
    setCount(paint(t));
  }, [
    enabled,
    playing,
    referenceTime,
    strikes,
    timelineStart,
    timelineEnd,
    paint,
    bounds,
    iconStyle,
  ]);

  // Play: interpolate clock in rAF and paint — zero React commits per tick.
  useEffect(() => {
    if (!enabled || !playing || referenceTime == null) return;

    const from = referenceTime;
    const to =
      nextFrameTime != null && nextFrameTime > from
        ? nextFrameTime
        : from + Math.max(60, Math.round(msPerFrame / 8));
    const started = performance.now();
    const duration = Math.max(80, msPerFrame);
    let raf = 0;
    let lastCountAt = 0;

    const tick = (now: number) => {
      const u = Math.min(1, (now - started) / duration);
      const eased = u * u * (3 - 2 * u);
      const animTime = Math.round(from + (to - from) * eased);
      const n = paint(animTime);
      if (now - lastCountAt > 250) {
        lastCountAt = now;
        setCount(n);
      }
      if (u < 1) raf = requestAnimationFrame(tick);
      else setCount(n);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, playing, referenceTime, nextFrameTime, msPerFrame, paint]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !enabled) return;
    const ro = new ResizeObserver(() => {
      const t = referenceTime ?? Math.floor(Date.now() / 1000);
      const n = paint(t);
      if (!playing) setCount(n);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [enabled, paint, playing, referenceTime]);

  if (!enabled) return null;

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none absolute inset-0 z-[30] overflow-hidden"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <span className="sr-only" aria-live="polite">
        {count} lightning strikes
      </span>
    </div>
  );
}

const iconCache = new Map<string, L.DivIcon>();

function crosshairHtml(color: string, size: number, opacity: number) {
  const gap = Math.max(1, Math.round(size * 0.12));
  const thick = Math.max(1, size * 0.14);
  return `<span class="skywatch-lightning-crosshair" style="width:${size}px;height:${size}px;color:${color};opacity:${opacity};--lg-gap:${gap}px;--lg-thick:${thick}px"><i></i><b></b></span>`;
}

function boltHtml(color: string, size: number, opacity: number) {
  const w = Math.max(10, size);
  const h = Math.max(14, Math.round(size * 1.25));
  return `<span class="skywatch-lightning-bolt" style="width:${w}px;height:${h}px;color:${color};opacity:${opacity}"><svg viewBox="0 0 24 32" width="${w}" height="${h}" aria-hidden="true"><path fill="currentColor" stroke="rgba(0,0,0,0.45)" stroke-width="1.2" stroke-linejoin="round" d="M13.2 1.2 4.6 17.4h6.1L8.8 30.8l11.6-18.2h-6.4L13.2 1.2z"/></svg></span>`;
}

function cachedLightningIcon(
  style: LightningIconStyle,
  color: string,
  size: number,
  opacity: number,
) {
  const op = Math.round(opacity * 10) / 10;
  const key = `${style}|${color}|${size}|${op}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const html =
      style === "bolt"
        ? boltHtml(color, size, op)
        : crosshairHtml(color, size, op);
    const box =
      style === "bolt"
        ? [Math.max(10, size), Math.max(14, Math.round(size * 1.25))]
        : [size, size];
    icon = L.divIcon({
      className: "skywatch-lightning-marker",
      html,
      iconSize: box as [number, number],
      iconAnchor: [box[0]! / 2, box[1]! / 2],
    });
    iconCache.set(key, icon);
    if (iconCache.size > 240) {
      const first = iconCache.keys().next().value;
      if (first) iconCache.delete(first);
    }
  }
  return icon;
}

/** Leaflet map/radar — discrete frame updates only, tiny DOM budget. */
export function LeafletLightningOverlay({
  strikes,
  enabled,
  referenceTime = null,
  timelineStart = null,
  timelineEnd = null,
  iconStyle = "crosshair",
}: LightningAnimProps) {
  const animTime = useFrameAnimTime(enabled, referenceTime);
  const visible = useMemo(() => {
    if (!enabled) return [];
    return strikesForAnimation(
      strikes,
      animTime,
      timelineStart,
      timelineEnd,
      LIGHTNING_MAX_VISIBLE_DOM,
    );
  }, [enabled, strikes, animTime, timelineStart, timelineEnd]);

  if (!enabled) return null;

  return (
    <>
      {visible.map((strike) => {
        const age = strikeAgeSeconds(strike, animTime);
        const opacity = strikeOpacity(age);
        if (opacity <= 0.05) return null;
        const color = strikeAgeColor(age);
        // Leaflet markers need a bit more size than the canvas trail.
        const size = Math.max(16, strikeAgeSize(age));
        return (
          <Marker
            key={strike.id}
            position={[strike.lat, strike.lon]}
            opacity={opacity}
            icon={cachedLightningIcon(iconStyle, color, size, opacity)}
            interactive={false}
            zIndexOffset={800}
          />
        );
      })}
    </>
  );
}
