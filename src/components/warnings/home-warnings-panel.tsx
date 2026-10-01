"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useWarnings } from "@/hooks/use-warnings";
import {
  WarningSeverityBadge,
  warningSeverityClasses,
} from "@/components/warnings/warning-severity";
import {
  WARNING_CATEGORIES,
  formatWarningTime,
  groupWarningsByCategory,
  type BomWarningSummary,
} from "@/lib/weather/warnings";
import { cn } from "@/lib/utils";

const HOME_LIMITS: Record<(typeof WARNING_CATEGORIES)[number], number> = {
  critical: 3,
  severe: 3,
  moderate: 2,
  minor: 2,
};

function WarningRow({ w }: { w: BomWarningSummary }) {
  const tone = warningSeverityClasses(w.severity);
  return (
    <Link
      href={w.href}
      className={cn("flex gap-2 border p-2 transition", tone.row)}
    >
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center",
          tone.icon,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          {w.states.slice(0, 3).map((s) => (
            <span
              key={s}
              className="text-[10px] font-bold uppercase tracking-wide text-white/70"
            >
              {s}
            </span>
          ))}
        </div>
        <p className="text-sm font-bold text-[var(--ink)]">{w.shortTitle}</p>
        <p className="line-clamp-2 text-xs text-[var(--ink)]/75">{w.title}</p>
        {w.issueTime ? (
          <p className="mt-0.5 text-[10px] text-white/55">
            Issued {formatWarningTime(w.issueTime)}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

export function HomeWarningsPanel() {
  const { warnings, loading, error, activeCount } = useWarnings();

  const groups = useMemo(() => {
    const active = warnings.filter((w) => w.severity !== "cancelled");
    return groupWarningsByCategory(active).map((g) => ({
      ...g,
      items: g.items.slice(0, HOME_LIMITS[g.category]),
      total: g.items.length,
    }));
  }, [warnings]);

  const shownCount = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <section className="border border-white/15 bg-[var(--bom-blue-mid)] p-3 text-[var(--ink)]">
      <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-white/15 pb-1.5">
        <h2 className="text-sm font-bold tracking-wide text-[var(--ink)]">
          Weather Warnings
        </h2>
        {!loading && !error ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">
            {activeCount} active
          </span>
        ) : null}
      </div>

      {loading && shownCount === 0 ? (
        <p className="text-sm text-white/70">Loading BoM warnings…</p>
      ) : null}

      {error && shownCount === 0 ? (
        <p className="text-sm text-white/80">
          Warnings temporarily unavailable.{" "}
          <Link href="/warnings" className="font-semibold underline">
            Try the full list
          </Link>
        </p>
      ) : null}

      {!loading && !error && shownCount === 0 ? (
        <p className="text-sm text-white/80">
          No Bureau of Meteorology warnings current.
        </p>
      ) : null}

      <div className="space-y-3">
        {groups.map((group) => {
          const tone = warningSeverityClasses(group.category);
          return (
            <div key={group.category}>
              <div
                className={cn(
                  "mb-1.5 flex items-center justify-between gap-2 border-b pb-1",
                  tone.heading,
                )}
              >
                <h3 className="text-[11px] font-bold uppercase tracking-wide">
                  {group.label}
                </h3>
                <WarningSeverityBadge
                  severity={group.category}
                  label={`${group.total}`}
                />
              </div>
              <ul className="space-y-2">
                {group.items.map((w) => (
                  <li key={w.id}>
                    <WarningRow w={w} />
                  </li>
                ))}
              </ul>
              {group.total > group.items.length ? (
                <Link
                  href={`/warnings?category=${group.category}`}
                  className="mt-1 inline-block text-[11px] font-semibold text-white/70 hover:text-white hover:underline"
                >
                  +{group.total - group.items.length} more {group.label.toLowerCase()} →
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>

      <Link
        href="/warnings"
        className="mt-3 inline-block text-xs font-semibold text-[var(--ink)] hover:underline"
      >
        All warnings →
      </Link>
    </section>
  );
}
