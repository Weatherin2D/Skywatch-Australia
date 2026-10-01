"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { SiteShell } from "@/components/site/site-shell";
import {
  WarningSeverityBadge,
  warningSeverityClasses,
} from "@/components/warnings/warning-severity";
import { useWarnings } from "@/hooks/use-warnings";
import {
  WARNING_CATEGORIES,
  formatWarningTime,
  groupWarningsByCategory,
  isWarningCategory,
  severityLabel,
  type BomWarningSummary,
  type WarningCategory,
} from "@/lib/weather/warnings";
import { cn } from "@/lib/utils";

function categoryHref(category: WarningCategory | null, state: string) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (state) params.set("state", state.toLowerCase());
  const q = params.toString();
  return q ? `/warnings?${q}` : "/warnings";
}

function WarningCard({ w }: { w: BomWarningSummary }) {
  const tone = warningSeverityClasses(w.severity);
  return (
    <Link
      href={w.href}
      className={cn(
        "group flex gap-3 rounded-lg border p-3 transition sm:p-3.5",
        tone.row,
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          tone.icon,
        )}
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-white/70">
            {w.states.join(" · ") || w.state}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-white/40">
            {w.phase}
          </span>
        </div>
        <p className="text-base font-bold text-white">{w.shortTitle}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-white/70">{w.title}</p>
        {w.issueTime ? (
          <p className="mt-1.5 text-xs text-white/50">
            Issued {formatWarningTime(w.issueTime)}
            {w.expiryTime
              ? ` · Expires ${formatWarningTime(w.expiryTime)}`
              : ""}
          </p>
        ) : null}
      </div>
      <ChevronRight
        className="mt-2 h-4 w-4 shrink-0 text-white/35 transition group-hover:text-white/70"
        aria-hidden
      />
    </Link>
  );
}

export function WarningsListPage() {
  const search = useSearchParams();
  const stateFilter = (search.get("state") || "").toUpperCase();
  const categoryParam = (search.get("category") || "").toLowerCase();
  const categoryFilter = isWarningCategory(categoryParam)
    ? categoryParam
    : null;
  const { warnings, loading, error, activeCount, states } = useWarnings();

  const filtered = useMemo(() => {
    return warnings.filter((w) => {
      if (categoryFilter) {
        if (w.severity !== categoryFilter) return false;
      }
      if (!stateFilter) return true;
      return w.states.map((s) => s.toUpperCase()).includes(stateFilter);
    });
  }, [warnings, stateFilter, categoryFilter]);

  const groups = useMemo(() => {
    const active = filtered.filter((w) => w.severity !== "cancelled");
    const grouped = groupWarningsByCategory(active);
    if (categoryFilter) {
      return grouped.filter((g) => g.category === categoryFilter);
    }
    return grouped;
  }, [filtered, categoryFilter]);

  const cancelled = useMemo(() => {
    if (categoryFilter) return [];
    return filtered.filter((w) => w.severity === "cancelled");
  }, [filtered, categoryFilter]);

  const categoryCounts = useMemo(() => {
    const active = warnings.filter((w) => {
      if (w.severity === "cancelled") return false;
      if (!stateFilter) return true;
      return w.states.map((s) => s.toUpperCase()).includes(stateFilter);
    });
    return Object.fromEntries(
      WARNING_CATEGORIES.map((c) => [
        c,
        active.filter((w) => w.severity === c).length,
      ]),
    ) as Record<WarningCategory, number>;
  }, [warnings, stateFilter]);

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[960px] px-3 py-5 sm:px-4 sm:py-6">
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bom-yellow)]">
            Bureau of Meteorology
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">
            Current warnings
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-white/70">
            Live Australian weather warnings by severity — Critical, Severe,
            Moderate, and Minor.
          </p>
        </div>

        <div className="mb-4 space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
              Category
            </p>
            <div className="sw-chip-row">
              <Link
                href={categoryHref(null, stateFilter)}
                className={cn(
                  "sw-chip",
                  !categoryFilter ? "sw-chip-active" : "sw-chip-idle",
                )}
              >
                All ({activeCount})
              </Link>
              {WARNING_CATEGORIES.map((c) => {
                const tone = warningSeverityClasses(c);
                const count = categoryCounts[c];
                return (
                  <Link
                    key={c}
                    href={categoryHref(c, stateFilter)}
                    className={cn(
                      "sw-chip",
                      categoryFilter === c ? tone.badge : "sw-chip-idle",
                    )}
                  >
                    {severityLabel(c)}
                    {count ? ` (${count})` : ""}
                  </Link>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
              State
            </p>
            <div className="sw-chip-row">
              <Link
                href={categoryHref(categoryFilter, "")}
                className={cn(
                  "sw-chip",
                  !stateFilter
                    ? "border-white/40 bg-white/15 text-white"
                    : "sw-chip-idle",
                )}
              >
                National
              </Link>
              {states.map((s) => (
                <Link
                  key={s}
                  href={categoryHref(categoryFilter, s)}
                  className={cn(
                    "sw-chip",
                    stateFilter === s
                      ? "border-white/40 bg-white/15 text-white"
                      : "sw-chip-idle",
                  )}
                >
                  {s}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {loading && groups.length === 0 ? (
          <p className="text-sm text-white/70">Loading warnings…</p>
        ) : null}
        {error && groups.length === 0 ? (
          <p className="rounded-lg border border-white/15 bg-[var(--bom-blue-mid)] p-4 text-sm text-white/80">
            {error}
          </p>
        ) : null}
        {!loading && !error && groups.length === 0 && cancelled.length === 0 ? (
          <p className="rounded-lg border border-white/15 bg-[var(--bom-blue-mid)] p-4 text-sm text-white/80">
            No warnings
            {categoryFilter ? ` in ${severityLabel(categoryFilter)}` : ""}
            {stateFilter ? ` for ${stateFilter}` : ""} right now.
          </p>
        ) : null}

        <div className="space-y-6">
          {groups.map((group) => {
            const tone = warningSeverityClasses(group.category);
            return (
              <section key={group.category}>
                <div
                  className={cn(
                    "mb-2.5 flex items-center justify-between gap-2 border-b pb-2",
                    tone.heading,
                  )}
                >
                  <h2 className="text-sm font-bold uppercase tracking-wide">
                    {group.label}
                  </h2>
                  <WarningSeverityBadge
                    severity={group.category}
                    label={`${group.items.length}`}
                  />
                </div>
                <ul className="space-y-2">
                  {group.items.map((w) => (
                    <li key={w.id}>
                      <WarningCard w={w} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {cancelled.length > 0 ? (
            <section>
              <div
                className={cn(
                  "mb-2.5 flex items-center justify-between gap-2 border-b pb-2",
                  warningSeverityClasses("cancelled").heading,
                )}
              >
                <h2 className="text-sm font-bold uppercase tracking-wide">
                  Cancelled
                </h2>
                <WarningSeverityBadge
                  severity="cancelled"
                  label={`${cancelled.length}`}
                />
              </div>
              <ul className="space-y-2">
                {cancelled.map((w) => (
                  <li key={w.id}>
                    <WarningCard w={w} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </SiteShell>
  );
}
