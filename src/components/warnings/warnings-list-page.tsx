"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteNav } from "@/components/site/site-nav";
import { WarningsBar } from "@/components/site/warnings-bar";
import {
  WarningSeverityBadge,
  warningSeverityClasses,
} from "@/components/warnings/warning-severity";
import { useWarnings } from "@/hooks/use-warnings";
import { formatWarningTime } from "@/lib/weather/warnings";
import { cn } from "@/lib/utils";

export function WarningsListPage() {
  const search = useSearchParams();
  const stateFilter = (search.get("state") || "").toUpperCase();
  const { warnings, loading, error, activeCount, states } = useWarnings();

  const filtered = useMemo(() => {
    if (!stateFilter) return warnings;
    return warnings.filter((w) =>
      w.states.map((s) => s.toUpperCase()).includes(stateFilter),
    );
  }, [warnings, stateFilter]);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--page)]">
      <SiteHeader />
      <WarningsBar />
      <SiteNav />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-3 py-6 sm:px-4">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bom-yellow)]">
            Bureau of Meteorology
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">
            Current warnings
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/75">
            Live Australian weather warnings, sorted by severity. Tap any
            warning for the full BoM text and maps.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link
            href="/warnings"
            className={cn(
              "border px-2.5 py-1 text-xs font-semibold",
              !stateFilter
                ? "border-[var(--bom-yellow)] bg-[var(--bom-yellow)] text-[var(--brand)]"
                : "border-white/20 text-white/85 hover:bg-white/10",
            )}
          >
            All ({activeCount} active)
          </Link>
          {states.map((s) => (
            <Link
              key={s}
              href={`/warnings?state=${s.toLowerCase()}`}
              className={cn(
                "border px-2.5 py-1 text-xs font-semibold",
                stateFilter === s
                  ? "border-[var(--bom-yellow)] bg-[var(--bom-yellow)] text-[var(--brand)]"
                  : "border-white/20 text-white/85 hover:bg-white/10",
              )}
            >
              {s}
            </Link>
          ))}
        </div>

        {loading && filtered.length === 0 ? (
          <p className="text-sm text-white/70">Loading warnings…</p>
        ) : null}
        {error && filtered.length === 0 ? (
          <p className="text-sm text-white/80">{error}</p>
        ) : null}
        {!loading && !error && filtered.length === 0 ? (
          <p className="text-sm text-white/80">
            No warnings{stateFilter ? ` for ${stateFilter}` : ""} right now.
          </p>
        ) : null}

        <ul className="space-y-2">
          {filtered.map((w) => {
            const tone = warningSeverityClasses(w.severity);
            return (
              <li key={w.id}>
                <Link
                  href={w.href}
                  className={cn(
                    "flex gap-3 border p-3 transition",
                    tone.row,
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center",
                      tone.icon,
                    )}
                  >
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <WarningSeverityBadge
                        severity={w.severity}
                        label={w.severityLabel}
                      />
                      <span className="text-[11px] font-bold uppercase tracking-wide text-white/70">
                        {w.states.join(" · ") || w.state}
                      </span>
                      <span className="text-[11px] uppercase tracking-wide text-white/45">
                        {w.phase}
                      </span>
                    </div>
                    <p className="text-base font-bold text-white">
                      {w.shortTitle}
                    </p>
                    <p className="mt-0.5 text-sm text-white/75">{w.title}</p>
                    {w.issueTime ? (
                      <p className="mt-1 text-xs text-white/55">
                        Issued {formatWarningTime(w.issueTime)}
                        {w.expiryTime
                          ? ` · Expires ${formatWarningTime(w.expiryTime)}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
