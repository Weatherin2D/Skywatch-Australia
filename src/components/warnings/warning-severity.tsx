import { cn } from "@/lib/utils";
import type { WarningSeverity } from "@/lib/weather/warnings";

export function warningSeverityClasses(severity: WarningSeverity): {
  badge: string;
  icon: string;
  row: string;
  heading: string;
} {
  switch (severity) {
    case "critical":
      return {
        badge: "bg-red-600 text-white",
        icon: "bg-red-600 text-white",
        row: "border-red-400/40 bg-red-500/15 hover:bg-red-500/25",
        heading: "border-red-500/50 text-red-300",
      };
    case "severe":
      return {
        badge: "bg-[var(--bom-yellow)] text-[var(--brand)]",
        icon: "bg-[var(--bom-yellow)] text-[var(--brand)]",
        row: "border-[var(--bom-yellow)]/35 bg-[var(--bom-yellow)]/10 hover:bg-[var(--bom-yellow)]/18",
        heading: "border-[var(--bom-yellow)]/50 text-[var(--bom-yellow)]",
      };
    case "moderate":
      return {
        badge: "bg-orange-300 text-orange-950",
        icon: "bg-orange-300 text-orange-950",
        row: "border-orange-300/35 bg-orange-400/10 hover:bg-orange-400/18",
        heading: "border-orange-300/45 text-orange-200",
      };
    case "cancelled":
      return {
        badge: "bg-white/20 text-white/80",
        icon: "bg-white/20 text-white/70",
        row: "border-white/10 bg-white/5 opacity-70 hover:bg-white/10",
        heading: "border-white/20 text-white/60",
      };
    default:
      return {
        badge: "bg-sky-200 text-sky-950",
        icon: "bg-sky-200 text-sky-950",
        row: "border-sky-300/30 bg-sky-400/10 hover:bg-sky-400/18",
        heading: "border-sky-300/40 text-sky-200",
      };
  }
}

export function WarningSeverityBadge({
  severity,
  label,
  className,
}: {
  severity: WarningSeverity;
  label: string;
  className?: string;
}) {
  const tone = warningSeverityClasses(severity);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tone.badge,
        className,
      )}
    >
      {label}
    </span>
  );
}
