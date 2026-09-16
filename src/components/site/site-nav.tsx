"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CloudLightning,
  CloudSun,
  Home,
  LineChart,
  Map,
  RadioTower,
  Thermometer,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/weather-map", label: "Weather Map", icon: Map },
  { href: "/forecast", label: "Forecast", icon: CloudSun },
  { href: "/severe-weather", label: "Severe Weather", icon: CloudLightning },
  { href: "/observations", label: "Observations", icon: RadioTower },
  { href: "/soundings", label: "Soundings", icon: LineChart },
  { href: "/climate", label: "Climate", icon: Thermometer },
  { href: "/learn", label: "Learn", icon: BookOpen },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="border-y border-[var(--border)] bg-[var(--navy)]/90"
    >
      <div className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto px-3 sm:px-5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition",
                active
                  ? "border-[var(--sky)] text-white"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 opacity-90" aria-hidden />
              <span className="whitespace-nowrap">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
