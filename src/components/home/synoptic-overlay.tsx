"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageOverlay } from "react-leaflet";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import {
  SYNOPTIC_BOUNDS,
  SYNOPTIC_OPACITY,
  pickSynopticFrame,
} from "@/lib/weather/synoptic";
import { formatFrameTimeAEST } from "@/lib/weather/maps";

function useNowTick(enabled: boolean) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function useActiveSynopticFrame(
  enabled: boolean,
  frames: SynopticFrame[],
  referenceTime: number | null | undefined,
) {
  const now = useNowTick(enabled && referenceTime == null);
  const ref = referenceTime ?? now;
  return useMemo(
    () => (enabled ? pickSynopticFrame(frames, ref) : null),
    [enabled, frames, ref],
  );
}

/** Full-bleed synoptic chart over the satellite image plane. */
export function SatelliteSynopticOverlay({
  frames,
  enabled,
  referenceTime = null,
  opacity = SYNOPTIC_OPACITY,
}: {
  frames: SynopticFrame[];
  enabled: boolean;
  referenceTime?: number | null;
  opacity?: number;
}) {
  const frame = useActiveSynopticFrame(enabled, frames, referenceTime);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!frame?.imageUrl) {
      setDisplayUrl(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.decoding = "async";
    const commit = () => {
      if (!cancelled) setDisplayUrl(frame.imageUrl);
    };
    img.onload = () => {
      if (typeof img.decode === "function") {
        void img.decode().then(commit).catch(commit);
      } else {
        commit();
      }
    };
    img.onerror = () => {
      if (!cancelled) setDisplayUrl(null);
    };
    img.src = frame.imageUrl;
    return () => {
      cancelled = true;
    };
  }, [frame?.imageUrl]);

  if (!enabled || !displayUrl) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displayUrl}
      alt="Synoptic chart overlay"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full object-fill select-none"
      style={{ opacity }}
      draggable={false}
    />
  );
}

/** Leaflet ImageOverlay for Map / Radar. */
export function LeafletSynopticOverlay({
  frames,
  enabled,
  referenceTime = null,
  opacity = SYNOPTIC_OPACITY,
}: {
  frames: SynopticFrame[];
  enabled: boolean;
  referenceTime?: number | null;
  opacity?: number;
}) {
  const frame = useActiveSynopticFrame(enabled, frames, referenceTime);
  if (!enabled || !frame) return null;

  return (
    <ImageOverlay
      key={frame.stamp}
      url={frame.imageUrl}
      bounds={SYNOPTIC_BOUNDS}
      opacity={opacity}
      zIndex={450}
    />
  );
}

export function SynopticLegend({
  frames,
  attribution,
  referenceTime = null,
  loading,
  error,
}: {
  frames: SynopticFrame[];
  attribution?: string | null;
  referenceTime?: number | null;
  loading?: boolean;
  error?: string | null;
}) {
  const now = Math.floor(Date.now() / 1000);
  const ref = referenceTime ?? now;
  const frame = pickSynopticFrame(frames, ref);

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-[1000] max-w-[14rem] border border-white/25 bg-black/70 px-2.5 py-2 text-white backdrop-blur-sm">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--bom-yellow)]">
        Synoptic chart
      </p>
      {error ? (
        <p className="text-[10px] text-red-300">{error}</p>
      ) : loading && !frame ? (
        <p className="text-[10px] text-white/75">Loading BoM analysis…</p>
      ) : frame ? (
        <>
          <p className="text-[11px] text-white/90">
            MSLP analysis · {formatFrameTimeAEST(frame.time)}
          </p>
          <p className="mt-0.5 text-[9px] text-white/55">
            Valid {frame.stamp.slice(0, 8)} {frame.stamp.slice(8, 12)} UTC
          </p>
        </>
      ) : (
        <p className="text-[10px] text-white/75">No chart available</p>
      )}
      {attribution ? (
        <p className="mt-1.5 text-[8px] leading-snug text-white/45">
          {attribution}
        </p>
      ) : null}
    </div>
  );
}
