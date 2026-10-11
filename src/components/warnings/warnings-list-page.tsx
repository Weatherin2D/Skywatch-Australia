"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight, Radio } from "lucide-react";
import { SiteShell } from "@/components/site/site-shell";
import {
  WarningSeverityBadge,
  warningSeverityClasses,
} from "@/components/warnings/warning-severity";
import { useWarnings } from "@/hooks/use-warnings";
import { useStormCells } from "@/hooks/use-storm-cells";
import { WarningAlertSettings } from "@/components/warnings/alert-settings";
import {
  WARNING_CATEGORIES,
  formatWarningTime,
  groupWarningsByCategory,
  isWarningCategory,
  severityLabel,
  type BomWarningSummary,
  type WarningCategory,
} from "@/lib/weather/warnings";
import {
  formatThreatEta,
  type StormCellAlert,
} from "@/lib/weather/storm-cell-types";
import { cn } from "@/lib/utils";

type WarningSource = "bom" | "auto";

function categoryHref(
  category: WarningCategory | null,
  state: string,
  source: WarningSource,
) {
  const params = new URLSearchParams();
  if (source !== "bom") params.set("source", source);
  if (category) params.set("category", category);
  if (state) params.set("state", state.toLowerCase());
  const q = params.toString();
  return q ? `/warnings?${q}` : "/warnings";
}

function sourceHref(source: WarningSource) {
  return source === "bom" ? "/warnings" : "/warnings?source=auto";
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

function AutoAlertCard({ alert }: { alert: StormCellAlert }) {
  const isWarning = alert.alertLevel === "warning";
  return (
    <Link
      href={alert.href}
      className={cn(
        "group flex gap-3 rounded-lg border p-3 transition sm:p-3.5",
        isWarning
          ? "border-orange-400/35 bg-orange-500/10 hover:border-orange-300/50"
          : "border-amber-300/30 bg-amber-400/10 hover:border-amber-200/45",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-extrabold",
          isWarning
            ? "bg-orange-500/25 text-orange-100"
            : "bg-amber-400/20 text-amber-100",
        )}
      >
        {alert.score}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-white/70">
            StormFront Australia estimate: {alert.alertLevel}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-white/40">
            score {alert.score}/100
          </span>
        </div>
        <p className="text-base font-bold text-white">
          Thunderstorm cell · {alert.label}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm text-white/70">
          {alert.summary}
        </p>
        {alert.threatTowns?.length ? (
          <p className="mt-1.5 text-xs text-white/80">
            <span className="font-semibold text-white/55">Towns: </span>
            {alert.threatTowns
              .slice(0, 4)
              .map(
                (t) => `${t.name} (${formatThreatEta(t.minutesAhead)})`,
              )
              .join(" · ")}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-white/50">
          {alert.lat.toFixed(2)}°, {alert.lon.toFixed(2)}° · lightning-tracked
        </p>
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
  const source: WarningSource =
    search.get("source") === "auto" ? "auto" : "bom";
  const stateFilter = (search.get("state") || "").toUpperCase();
  const categoryParam = (search.get("category") || "").toLowerCase();
  const categoryFilter = isWarningCategory(categoryParam)
    ? categoryParam
    : null;
  const { warnings, loading, error, activeCount, states } = useWarnings();
  const {
    data: cellsData,
    loading: cellsLoading,
    error: cellsError,
  } = useStormCells(45_000, source === "auto");

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

  const autoAlerts = useMemo(() => {
    const list = cellsData?.alerts ?? [];
    return [...list].sort((a, b) => b.score - a.score);
  }, [cellsData]);

  const autoWarnings = autoAlerts.filter((a) => a.alertLevel === "warning");
  const autoWatches = autoAlerts.filter((a) => a.alertLevel === "watch");

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[960px] px-3 py-5 sm:px-4 sm:py-6">
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
            {source === "bom"
              ? "Bureau of Meteorology"
              : "StormFront Australia thunderstorm estimates"}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white sm:text-3xl">
            Current warnings
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-white/70">
            {source === "bom"
              ? "Live Australian weather warnings by severity — Critical, Severe, Moderate, and Minor."
              : "Thunderstorm cells identified from lightning activity. Scores are estimates, not official Bureau of Meteorology warnings."}
          </p>
        </div>

        <div className="mb-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
            Source
          </p>
          <div className="sw-chip-row">
            <Link
              href={sourceHref("bom")}
              className={cn(
                "sw-chip",
                source === "bom" ? "sw-chip-active" : "sw-chip-idle",
              )}
            >
              BoM
            </Link>
            <Link
              href={sourceHref("auto")}
              className={cn(
                "sw-chip",
                source === "auto" ? "sw-chip-active" : "sw-chip-idle",
              )}
            >
              Automated
              {source === "auto" && autoAlerts.length
                ? ` (${autoAlerts.length})`
                : ""}
            </Link>
          </div>
        </div>

        <WarningAlertSettings />

        {source === "bom" ? (
          <>
            <div className="mb-4 space-y-3">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                  Category
                </p>
                <div className="sw-chip-row">
                  <Link
                    href={categoryHref(null, stateFilter, "bom")}
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
                        href={categoryHref(c, stateFilter, "bom")}
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
                    href={categoryHref(categoryFilter, "", "bom")}
                    className={cn(
                      "sw-chip",
                      !stateFilter ? "sw-chip-active" : "sw-chip-idle",
                    )}
                  >
                    National
                  </Link>
                  {states.map((s) => (
                    <Link
                      key={s}
                      href={categoryHref(categoryFilter, s, "bom")}
                      className={cn(
                        "sw-chip",
                        stateFilter === s ? "sw-chip-active" : "sw-chip-idle",
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
              <p className="sw-panel p-4 text-sm text-white/80">{error}</p>
            ) : null}
            {!loading &&
            !error &&
            groups.length === 0 &&
            cancelled.length === 0 ? (
              <p className="sw-panel p-4 text-sm text-white/80">
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
          </>
        ) : (
          <div className="space-y-6">
            {cellsLoading && !autoAlerts.length ? (
              <p className="text-sm text-white/70">
                Scanning active thunderstorm cells…
              </p>
            ) : null}
            {cellsError && !autoAlerts.length ? (
              <p className="sw-panel p-4 text-sm text-white/80">{cellsError}</p>
            ) : null}
            {!cellsLoading && !cellsError && autoAlerts.length === 0 ? (
              <p className="sw-panel p-4 text-sm text-white/80">
                No automated Watch or Warning thunderstorm cells right now.
                Cells need a score of 55+ (Watch) or 75+ (Warning).
              </p>
            ) : null}

            {autoWarnings.length > 0 ? (
              <section>
                <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-orange-400/30 pb-2 text-orange-200">
                  <h2 className="text-sm font-bold uppercase tracking-wide">
                    StormFront Australia warning estimate
                  </h2>
                  <span className="rounded-full border border-orange-400/40 bg-orange-500/15 px-2 py-0.5 text-[11px] font-bold">
                    {autoWarnings.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {autoWarnings.map((a) => (
                    <li key={a.id}>
                      <AutoAlertCard alert={a} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {autoWatches.length > 0 ? (
              <section>
                <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-amber-300/30 pb-2 text-amber-100">
                  <h2 className="text-sm font-bold uppercase tracking-wide">
                    StormFront Australia watch estimate
                  </h2>
                  <span className="rounded-full border border-amber-300/40 bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold">
                    {autoWatches.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {autoWatches.map((a) => (
                    <li key={a.id}>
                      <AutoAlertCard alert={a} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="flex items-center gap-1.5 text-[11px] text-white/45">
              <Radio className="h-3.5 w-3.5" aria-hidden />
              {cellsData?.note ??
                "StormFront Australia estimates based on lightning activity. Not official Bureau of Meteorology warnings."}
            </p>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
