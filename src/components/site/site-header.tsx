"use client";

import { Search, Settings } from "lucide-react";
import { SkyWatchLogo } from "@/components/site/skywatch-logo";

export function SiteHeader() {
  return (
    <header className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--navy)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(900px 220px at 15% -40%, rgba(0,174,239,0.35), transparent 60%), radial-gradient(700px 200px at 85% 0%, rgba(56,189,248,0.18), transparent 55%), linear-gradient(180deg, #0c2748 0%, #0a1c36 100%)",
        }}
      />
      <div className="relative mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-5">
          <SkyWatchLogo />
          <p className="hidden text-sm text-[var(--muted-foreground)] md:block">
            Real weather. Deeper insight. A safer Australia.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative block w-[min(100vw-7rem,260px)]">
            <span className="sr-only">Search locations</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]"
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search locations…"
              className="h-10 w-full rounded-full border border-[var(--border)] bg-[var(--navy-deep)]/80 pl-9 pr-3 text-sm text-white outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--sky)] focus:ring-1 focus:ring-[var(--sky)]"
            />
          </label>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--navy-deep)]/80 text-[var(--muted-foreground)] transition hover:border-[var(--sky)] hover:text-white"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
