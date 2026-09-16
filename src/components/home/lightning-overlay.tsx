"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { LightningAgeBand, LightningStrike } from "@/lib/weather/lightning";
import {
  filterStrikesAtTime,
  strikeAgeBand,
  strikeAgeSeconds,
} from "@/lib/weather/lightning";
import { GIBS_AU_BOUNDS } from "@/lib/weather/maps";

const BAND_STYLE: Record<
  LightningAgeBand,
  { color: string; glow: string; size: number }
> = {
  new: { color: "#ffffff", glow: "rgba(255,255,255,0.9)", size: 14 },
  earlier: { color: "#ffca28", glow: "rgba(255,202,40,0.7)", size: 12 },
  old: { color: "#ef5350", glow: "rgba(239,83,80,0.55)", size: 10 },
};

function lonLatToPct(lon: number, lat: number) {
  const [[south, west], [north, east]] = GIBS_AU_BOUNDS;
  return {
    x: ((lon - west) / (east - west)) * 100,
    y: ((north - lat) / (north - south)) * 100,
  };
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
  const arm = Math.max(3, Math.round(size * 0.38));
  const gap = Math.max(2, Math.round(size * 0.14));
  const thick = Math.max(1.5, size * 0.12);
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
          filter: `drop-shadow(0 0 3px ${color})`,
        } as CSSProperties
      }
      aria-hidden
    />
  );
}

function crosshairHtml(color: string, size: number, pulse: boolean) {
  const arm = Math.max(3, Math.round(size * 0.38));
  const gap = Math.max(2, Math.round(size * 0.14));
  const thick = Math.max(1.5, size * 0.12);
  const cls = pulse
    ? "skywatch-lightning-crosshair skywatch-lightning-crosshair--new"
    : "skywatch-lightning-crosshair";
  return `<span class="${cls}" style="width:${size}px;height:${size}px;color:${color};--lg-arm:${arm}px;--lg-gap:${gap}px;--lg-thick:${thick}px;filter:drop-shadow(0 0 3px ${color})"></span>`;
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
    return filterStrikesAtTime(strikes, refTime, 30);
  }, [enabled, strikes, refTime]);

  if (!enabled || visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {visible.map((strike) => {
        const age = strikeAgeSeconds(strike, refTime);
        const band = strikeAgeBand(age);
        const style = BAND_STYLE[band];
        const { x, y } = lonLatToPct(strike.lon, strike.lat);
        return (
          <span
            key={strike.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <CrosshairIcon
              color={style.color}
              size={style.size}
              pulse={band === "new"}
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
    return filterStrikesAtTime(strikes, refTime, 30).slice(0, 120);
  }, [enabled, strikes, refTime]);

  const icons = useMemo(() => {
    const map = {} as Record<LightningAgeBand, L.DivIcon>;
    (Object.keys(BAND_STYLE) as LightningAgeBand[]).forEach((band) => {
      const style = BAND_STYLE[band];
      map[band] = L.divIcon({
        className: "skywatch-lightning-marker",
        html: crosshairHtml(style.color, style.size, band === "new"),
        iconSize: [style.size, style.size],
        iconAnchor: [style.size / 2, style.size / 2],
      });
    });
    return map;
  }, []);

  if (!enabled) return null;

  return (
    <>
      {visible.map((strike) => {
        const age = strikeAgeSeconds(strike, refTime);
        const band = strikeAgeBand(age);
        return (
          <Marker
            key={strike.id}
            position={[strike.lat, strike.lon]}
            icon={icons[band]}
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
  const visible = filterStrikesAtTime(strikes, refTime, 30);
  const counts = { new: 0, earlier: 0, old: 0 };
  for (const s of visible) {
    counts[strikeAgeBand(strikeAgeSeconds(s, refTime))] += 1;
  }

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

  const syncedLabel = frameSynced ? "satellite frame" : "live clock";

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
        <p className="max-w-[12rem] text-[10px] leading-snug text-white/75">
          {status === "live" || status === "reconnecting"
            ? frameSynced && referenceTime != null
              ? "No strikes at this frame time — scrub forward as storms develop…"
              : "No strikes over Australia in the last 30 min — listening live…"
            : "Connecting to live lightning feed…"}
        </p>
      ) : (
        <ul className="space-y-1 text-[10px] text-white/90">
          <li className="flex items-center gap-1.5">
            <span
              className="skywatch-lightning-crosshair inline-block"
              style={
                {
                  width: 10,
                  height: 10,
                  color: "#ffffff",
                  ["--lg-arm" as string]: "3px",
                  ["--lg-gap" as string]: "1.5px",
                  ["--lg-thick" as string]: "1.5px",
                } as CSSProperties
              }
            />
            New · {counts.new}
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="skywatch-lightning-crosshair inline-block"
              style={
                {
                  width: 10,
                  height: 10,
                  color: "#ffca28",
                  ["--lg-arm" as string]: "3px",
                  ["--lg-gap" as string]: "1.5px",
                  ["--lg-thick" as string]: "1.5px",
                } as CSSProperties
              }
            />
            Earlier · {counts.earlier}
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="skywatch-lightning-crosshair inline-block"
              style={
                {
                  width: 10,
                  height: 10,
                  color: "#ef5350",
                  ["--lg-arm" as string]: "3px",
                  ["--lg-gap" as string]: "1.5px",
                  ["--lg-thick" as string]: "1.5px",
                } as CSSProperties
              }
            />
            Older · {counts.old}
          </li>
        </ul>
      )}
      <p className="mt-1.5 text-[9px] text-white/60">
        {visible.length} strikes · synced to {syncedLabel}
      </p>
      {attribution ? (
        <p className="mt-0.5 max-w-[12rem] text-[8px] leading-snug text-white/45">
          {attribution}
        </p>
      ) : null}
    </div>
  );
}
