"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, Tooltip } from "react-leaflet";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
  strikeAgeBand,
  strikeAgeSeconds,
} from "@/lib/weather/lightning";
import { GIBS_AU_BOUNDS } from "@/lib/weather/maps";

const BAND_STYLE = {
  now: { fill: "#fff59d", stroke: "#ffffff", glow: "rgba(255,245,157,0.85)" },
  recent: { fill: "#ffca28", stroke: "#ffe082", glow: "rgba(255,202,40,0.65)" },
  aging: { fill: "#ff7043", stroke: "#ffab91", glow: "rgba(255,112,67,0.45)" },
  old: { fill: "#ce93d8", stroke: "#e1bee7", glow: "rgba(206,147,216,0.35)" },
} as const;

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

/** Satellite-frame lightning dots + flash rings. */
export function SatelliteLightningOverlay({
  strikes,
  enabled,
}: {
  strikes: LightningStrike[];
  enabled: boolean;
}) {
  const now = useNowTick(enabled);
  if (!enabled || strikes.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {strikes.map((strike) => {
        const age = strikeAgeSeconds(strike, now);
        const band = strikeAgeBand(age);
        const style = BAND_STYLE[band];
        const { x, y } = lonLatToPct(strike.lon, strike.lat);
        const size =
          band === "now"
            ? 7 + strike.intensity * 0.05
            : band === "recent"
              ? 5
              : band === "aging"
                ? 4
                : 3;
        return (
          <span
            key={strike.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            {band === "now" ? (
              <span
                className="skywatch-lightning-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: size * 3.2,
                  height: size * 3.2,
                  boxShadow: `0 0 0 1px ${style.glow}`,
                }}
              />
            ) : null}
            <span
              className="skywatch-lightning-dot block rounded-full"
              style={{
                width: size,
                height: size,
                background: style.fill,
                border: `1px solid ${style.stroke}`,
                boxShadow: `0 0 ${band === "now" ? 8 : 3}px ${style.glow}`,
                opacity: band === "old" ? 0.55 : 0.95,
              }}
            />
          </span>
        );
      })}
    </div>
  );
}

/** Leaflet lightning markers for Map / Radar views. */
export function LeafletLightningOverlay({
  strikes,
  enabled,
}: {
  strikes: LightningStrike[];
  enabled: boolean;
}) {
  const now = useNowTick(enabled);
  const visible = useMemo(() => {
    if (!enabled) return [];
    return strikes.slice(0, 120);
  }, [enabled, strikes]);

  if (!enabled) return null;

  return (
    <>
      {visible.map((strike) => {
        const age = strikeAgeSeconds(strike, now);
        const band = strikeAgeBand(age);
        const style = BAND_STYLE[band];
        const radius =
          band === "now" ? 7 : band === "recent" ? 5 : band === "aging" ? 4 : 3;
        return (
          <CircleMarker
            key={strike.id}
            center={[strike.lat, strike.lon]}
            radius={radius}
            pathOptions={{
              color: style.stroke,
              fillColor: style.fill,
              fillOpacity: band === "old" ? 0.45 : 0.9,
              weight: 1,
              opacity: 0.95,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              Lightning · {Math.round(age / 60)} min ago
              {strike.polarity ? (strike.polarity > 0 ? " · +" : " · −") : ""}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

export function LightningLegend({
  strikes,
  attribution,
}: {
  strikes: LightningStrike[];
  attribution?: string | null;
}) {
  const now = Math.floor(Date.now() / 1000);
  const counts = { now: 0, recent: 0, aging: 0, old: 0 };
  for (const s of strikes) {
    counts[strikeAgeBand(strikeAgeSeconds(s, now))] += 1;
  }

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] border border-white/25 bg-black/70 px-2.5 py-2 text-white backdrop-blur-sm">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--bom-yellow)]">
        Lightning tracker
      </p>
      <ul className="space-y-1 text-[10px] text-white/90">
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#fff59d] shadow-[0_0_6px_#fff59d]" />
          &lt; 2 min · {counts.now}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#ffca28]" />
          &lt; 10 min · {counts.recent}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#ff7043]" />
          &lt; 20 min · {counts.aging}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#ce93d8] opacity-70" />
          &lt; 30 min · {counts.old}
        </li>
      </ul>
      <p className="mt-1.5 text-[9px] text-white/60">
        {strikes.length} strikes · last 30 min
      </p>
      {attribution ? (
        <p className="mt-0.5 max-w-[11rem] text-[8px] leading-snug text-white/45">
          {attribution}
        </p>
      ) : null}
    </div>
  );
}
