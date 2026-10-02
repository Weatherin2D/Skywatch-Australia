"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useWarnings } from "@/hooks/use-warnings";

export function WarningsBar() {
  const { states, activeCount, loading } = useWarnings();

  return (
    <div className="border-b border-amber-400/30 bg-gradient-to-r from-amber-500/95 via-amber-400 to-yellow-300 text-[#1a1200]">
      <div className="mx-auto flex w-full max-w-[1680px] items-center gap-2 px-3 py-1.5 sm:gap-3 sm:px-4 sm:py-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1a1200] text-amber-300 sm:h-7 sm:w-7">
          <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="text-xs font-bold sm:text-sm">
              {loading
                ? "Checking warnings…"
                : activeCount > 0
                  ? `${activeCount} warning${activeCount === 1 ? "" : "s"} current`
                  : "No warnings current"}
            </p>
            {states.length ? (
              <nav
                aria-label="States with current warnings"
                className="flex max-w-full items-center gap-1.5 overflow-x-auto text-[11px] font-semibold sm:text-xs"
              >
                {states.map((state) => (
                  <Link
                    key={state}
                    href={`/warnings?state=${state.toLowerCase()}`}
                    className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 hover:bg-black/15"
                  >
                    {state}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
        </div>

        <Link
          href="/warnings"
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold hover:underline sm:text-sm"
        >
          All warnings
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
