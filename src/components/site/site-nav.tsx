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
      className="bg-[var(--navy-deep)] text-[var(--brand)]"
    >
      <div className="mx-auto flex w-full max-w-[1600px] gap-0 overflow-x-auto px-1 sm:px-2">
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
                "flex shrink-0 items-center gap-1.5 border-b-[3px] px-3 py-2.5 text-sm font-semibold transition",
                active
                  ? "border-[var(--bom-yellow)] bg-[var(--page)]/10 text-[var(--brand)]"
                  : "border-transparent text-[var(--brand)]/85 hover:bg-[var(--page)]/8 hover:text-[var(--brand)]",
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
