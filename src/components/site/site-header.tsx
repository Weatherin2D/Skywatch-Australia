"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, MapPin } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { SkyWatchLogo } from "@/components/site/skywatch-logo";
import { LocationSearch } from "@/components/forecast/location-search";
import {
  MORE_NAV,
  PRIMARY_NAV,
  PRIMARY_NAV_END,
  STATE_PILLS,
} from "@/components/site/nav-config";
import { STATE_CAPITALS } from "@/lib/weather/location-forecast";
import { cn } from "@/lib/utils";

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "relative flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition",
        active
          ? "bg-[var(--cyan)]/12 text-[var(--cyan)]"
          : "text-white/70 hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className="pointer-events-none h-4 w-4 opacity-90" aria-hidden />
      {label}
      {active ? (
        <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-[var(--cyan)]" />
      ) : null}
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close More on route change so the dropdown can't sit over the next page.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  function isActive(href: string) {
    return href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b16]/80 text-white backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2.5 px-3 py-2.5 sm:px-4 lg:px-5">
        <div className="flex items-center gap-3 lg:gap-5">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <Link href="/" className="min-w-0">
              <SkyWatchLogo size="sm" />
            </Link>
            <p className="hidden max-w-[11rem] text-[11px] leading-snug text-white/55 xl:block">
              Real weather. Deeper insight. A safer Australia.
            </p>
          </div>

          <nav
            aria-label="Primary"
            className="relative z-10 hidden min-w-0 flex-1 items-center gap-1 lg:flex"
          >
            {PRIMARY_NAV.map(({ href, label, icon }) => (
              <NavLink
                key={href}
                href={href}
                label={label}
                icon={icon}
                active={isActive(href)}
                onNavigate={() => setMoreOpen(false)}
              />
            ))}

            <div className="ml-auto flex items-center gap-1">
              {PRIMARY_NAV_END.map(({ href, label, icon }) => (
                <NavLink
                  key={href}
                  href={href}
                  label={label}
                  icon={icon}
                  active={isActive(href)}
                  onNavigate={() => setMoreOpen(false)}
                />
              ))}
              <div className="relative" ref={moreRef}>
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold transition",
                    moreOpen
                      ? "bg-white/10 text-white"
                      : "text-white/70 hover:bg-white/5 hover:text-white",
                  )}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                >
                  More
                  <ChevronDown className="pointer-events-none h-3.5 w-3.5" />
                </button>
                {moreOpen ? (
                  <ul
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-white/10 bg-[#0f172a]/95 py-1 shadow-xl backdrop-blur-xl"
                  >
                    {MORE_NAV.map((item) => (
                      <li key={item.href} role="none">
                        <Link
                          role="menuitem"
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          className="block px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/5 hover:text-white"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </nav>

          <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2 lg:ml-0 lg:max-w-md">
            <LocationSearch
              compact
              className="w-full max-w-[min(100%,280px)] sm:max-w-[240px]"
            />
          </div>
        </div>

        <nav
          aria-label="States"
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {STATE_PILLS.map((state) => {
            const key = state.toLowerCase();
            const capital = STATE_CAPITALS[key];
            const href = capital
              ? `/forecast/${capital.geohash}`
              : `/forecast?region=${key}`;
            return (
              <Link
                key={state}
                href={href}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold tracking-wide text-white/75 transition hover:border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/10 hover:text-[var(--cyan)]"
              >
                <MapPin className="pointer-events-none h-3 w-3 opacity-70" aria-hidden />
                {state}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
