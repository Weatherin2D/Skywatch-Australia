"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { SkyWatchLogo } from "@/components/site/skywatch-logo";
import { LocationSearch } from "@/components/forecast/location-search";
import { STATE_CAPITALS } from "@/lib/weather/location-forecast";

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
    <header className="sticky top-0 z-40 border-b border-[var(--brand)]/10 bg-[var(--bom-blue)] text-[var(--brand)]">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <SkyWatchLogo size="sm" inverted />
          <p className="hidden text-xs leading-snug text-[var(--brand)]/70 xl:block">
            Real weather. Deeper insight.
            <br />A safer Australia.
          </p>
        </div>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
          <nav
            aria-label="Regions"
            className="hidden items-center gap-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand)]/85 2xl:flex"
          >
            {STATES.map((state, i) => {
              const key = state.toLowerCase();
              const capital = STATE_CAPITALS[key];
              const href = capital
                ? `/forecast/${capital.geohash}`
                : `/forecast?region=${key}`;
              return (
                <span key={state} className="flex items-center">
                  {i > 0 ? (
                    <span className="px-1 text-[var(--brand)]/30" aria-hidden>
                      |
                    </span>
                  ) : null}
                  <Link href={href} className="hover:underline">
                    {state}
                  </Link>
                </span>
              );
            })}
          </nav>
          <LocationSearch
            compact
            className="w-full max-w-[min(100%,280px)] sm:max-w-[240px]"
          />
          <button
            type="button"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--brand)]/8 text-[var(--brand)] transition hover:bg-[var(--brand)]/12 sm:inline-flex"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
