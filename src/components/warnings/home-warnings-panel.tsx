"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useWarnings } from "@/hooks/use-warnings";
import {
  WarningSeverityBadge,
  warningSeverityClasses,
} from "@/components/warnings/warning-severity";
import { formatWarningTime } from "@/lib/weather/warnings";
import { cn } from "@/lib/utils";

export function HomeWarningsPanel({ limit = 6 }: { limit?: number }) {
  const { warnings, loading, error, activeCount } = useWarnings();
  const ranked = warnings.slice(0, limit);

  return (
    <section className="border border-white/15 bg-[var(--bom-blue-mid)] p-3 text-[var(--ink)]">
      <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-white/15 pb-1.5">
        <h2 className="text-sm font-bold tracking-wide text-[var(--ink)]">
          Severe Weather Warnings
        </h2>
        {!loading && !error ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">
            {activeCount} active
          </span>
        ) : null}
      </div>

      {loading && ranked.length === 0 ? (
        <p className="text-sm text-white/70">Loading BoM warnings…</p>
      ) : null}

      {error && ranked.length === 0 ? (
        <p className="text-sm text-white/80">
          Warnings temporarily unavailable.{" "}
          <Link href="/warnings" className="font-semibold underline">
            Try the full list
          </Link>
        </p>
      ) : null}

      {!loading && !error && ranked.length === 0 ? (
        <p className="text-sm text-white/80">
          No Bureau of Meteorology warnings current.
        </p>
      ) : null}

      {ranked.length > 0 ? (
        <ul className="space-y-2">
          {ranked.map((w) => {
            const tone = warningSeverityClasses(w.severity);
            return (
              <li key={w.id}>
                <Link
                  href={w.href}
                  className={cn(
                    "flex gap-2 border p-2 transition",
                    tone.row,
                  )}
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
                      <WarningSeverityBadge
                        severity={w.severity}
                        label={w.severityLabel}
                      />
                      {w.states.slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="text-[10px] font-bold uppercase tracking-wide text-white/70"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm font-bold text-[var(--ink)]">
                      {w.shortTitle}
                    </p>
                    <p className="line-clamp-2 text-xs text-[var(--ink)]/75">
                      {w.title}
                    </p>
                    {w.issueTime ? (
                      <p className="mt-0.5 text-[10px] text-white/55">
                        Issued {formatWarningTime(w.issueTime)}
                      </p>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Link
        href="/warnings"
        className="mt-2 inline-block text-xs font-semibold text-[var(--ink)] hover:underline"
      >
        All warnings →
      </Link>
    </section>
  );
}
