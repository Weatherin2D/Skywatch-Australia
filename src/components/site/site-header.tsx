"use client";

import Link from "next/link";
import { Search, Settings } from "lucide-react";
import { SkyWatchLogo } from "@/components/site/skywatch-logo";

const STATES = [
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT",
  "AUSTRALIA",
] as const;

export function SiteHeader() {
  return (
    <header className="bg-[var(--bom-blue)] text-[var(--brand)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
          <SkyWatchLogo size="sm" inverted />
          <p className="hidden text-xs text-[var(--brand)]/75 lg:block">
            Real weather. Deeper insight. A safer Australia.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav
            aria-label="Regions"
            className="hidden items-center gap-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand)]/90 xl:flex"
          >
            {STATES.map((state, i) => (
              <span key={state} className="flex items-center">
                {i > 0 ? (
                  <span className="px-1.5 text-[var(--brand)]/35" aria-hidden>
                    |
                  </span>
                ) : null}
                <Link
                  href={`/forecast?region=${state.toLowerCase()}`}
                  className="hover:underline"
                >
                  {state}
                </Link>
              </span>
            ))}
          </nav>
          <label className="relative block w-[min(100vw-8rem,200px)]">
            <span className="sr-only">Search locations</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/70"
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search locations…"
              className="h-8 w-full border-0 bg-[var(--page)] pl-8 pr-2 text-sm text-white outline-none placeholder:text-white/50"
            />
          </label>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center bg-[var(--brand)]/10 text-[var(--brand)] transition hover:bg-[var(--brand)]/15"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
