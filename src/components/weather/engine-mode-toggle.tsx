"use client";

import {
  ENGINE_UI_OPTIONS,
  type EngineUiMode,
} from "@/lib/weather/engine-mode";
import { cn } from "@/lib/utils";

type Props = {
  value: EngineUiMode;
  onChange: (mode: EngineUiMode) => void;
  className?: string;
  /** Compact density for tight toolbars */
  size?: "sm" | "md";
  "aria-label"?: string;
};

export function EngineModeToggle({
  value,
  onChange,
  className,
  size = "md",
  "aria-label": ariaLabel = "Thermo / AI engine",
}: Props) {
  return (
    <div
      className={cn(
        "inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {ENGINE_UI_OPTIONS.map(({ id, label, title }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          title={title}
          className={cn(
            "rounded-lg font-semibold transition",
            size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
            value === id
              ? id === "predict"
                ? "bg-amber-400 text-[#070b16]"
                : "bg-[var(--cyan)] text-[#070b16]"
              : "text-white/65 hover:text-white",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
