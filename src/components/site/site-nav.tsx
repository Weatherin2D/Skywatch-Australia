"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, CloudSun, Home, Siren } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/warnings", label: "Warnings", icon: Siren },
  { href: "/forecast", label: "Forecast", icon: CloudSun },
  { href: "/risk", label: "Risk", icon: AlertTriangle },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="border-b border-[var(--brand)]/10 bg-[var(--navy-deep)] text-[var(--brand)]"
    >
      <div className="mx-auto flex w-full max-w-[1600px] gap-0.5 overflow-x-auto px-2 sm:px-3">
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
                "flex shrink-0 items-center gap-1.5 rounded-t-md border-b-[3px] px-3.5 py-2.5 text-sm font-semibold transition",
                active
                  ? "border-[var(--cyan)] bg-[var(--page)]/8 text-[var(--brand)]"
                  : "border-transparent text-[var(--brand)]/75 hover:bg-[var(--page)]/6 hover:text-[var(--brand)]",
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
