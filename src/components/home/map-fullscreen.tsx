"use client";

import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

function getFullscreenElement(): Element | null {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

async function requestFullscreen(el: HTMLElement) {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  if (anyEl.webkitRequestFullscreen) {
    await anyEl.webkitRequestFullscreen();
  }
}

async function exitFullscreen() {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  if (doc.webkitExitFullscreen) {
    await doc.webkitExitFullscreen();
  }
}

export function useMapFullscreen(target: HTMLElement | null) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => {
      const fs = getFullscreenElement();
      setActive(!!target && fs === target);
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [target]);

  const toggle = useCallback(async () => {
    if (!target) return;
    try {
      if (getFullscreenElement() === target) {
        await exitFullscreen();
      } else {
        await requestFullscreen(target);
      }
    } catch {
      // User gesture / browser policy — ignore.
    }
  }, [target]);

  return { active, toggle };
}

export function MapFullscreenButton({
  target,
  className,
  compact = false,
}: {
  target: HTMLElement | null;
  className?: string;
  compact?: boolean;
}) {
  const { active, toggle } = useMapFullscreen(target);
  const Icon = active ? Minimize2 : Maximize2;

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      className={cn(
        "inline-flex items-center justify-center border border-white/15 bg-[#0f172a]/90 text-white shadow-lg backdrop-blur-md transition hover:border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/15 hover:text-[var(--cyan)]",
        compact ? "h-9 w-9 rounded-xl" : "h-9 gap-1.5 rounded-xl px-2.5 text-xs font-semibold",
        className,
      )}
      aria-label={active ? "Exit full screen" : "Full screen map"}
      title={active ? "Exit full screen" : "Full screen"}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {compact ? null : (
        <span className="hidden sm:inline">{active ? "Exit" : "Full screen"}</span>
      )}
    </button>
  );
}
