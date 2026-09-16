"use client";

import Link from "next/link";
import { AlertTriangle, ChevronDown } from "lucide-react";

const WARNING_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

export function WarningsBar() {
  return (
    <div className="bg-[var(--bom-yellow)] text-[var(--bom-blue)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--bom-blue)] text-[var(--bom-yellow)]">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
          <p className="text-sm font-bold">Warnings current</p>
          <nav
            aria-label="Current warning regions"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold sm:text-sm"
          >
            {WARNING_STATES.map((state) => (
              <Link
                key={state}
                href={`/severe-weather?state=${state.toLowerCase()}`}
                className="hover:underline"
              >
                {state}
              </Link>
            ))}
          </nav>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 border border-[var(--bom-blue)]/30 bg-white/40 px-2.5 py-1 text-xs font-semibold sm:text-sm"
        >
          Warning services
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
