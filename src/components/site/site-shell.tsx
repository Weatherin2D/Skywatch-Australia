"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, CloudSun, Home, Siren } from "lucide-react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteNav } from "@/components/site/site-nav";
import { WarningsBar } from "@/components/site/warnings-bar";
import { cn } from "@/lib/utils";

const MOBILE_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/warnings", label: "Warnings", icon: Siren },
  { href: "/forecast", label: "Forecast", icon: CloudSun },
  { href: "/risk", label: "Risk", icon: AlertTriangle },
] as const;

export function SiteShell({
  children,
  mainClassName,
}: {
  children: React.ReactNode;
  mainClassName?: string;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-[var(--page)]">
      <SiteHeader />
      <WarningsBar />
      <div className="hidden sm:block">
        <SiteNav />
      </div>
      <main className={cn("flex-1 pb-20 sm:pb-0", mainClassName)}>
        {children}
      </main>
      <SiteFooter />

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[var(--bom-blue-mid)]/95 backdrop-blur-md sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="mx-auto grid max-w-lg grid-cols-4">
          {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-semibold transition",
                    active
                      ? "text-[var(--bom-yellow)]"
                      : "text-white/65 hover:text-white",
                  )}
                >
                  <Icon
                    className={cn("h-5 w-5", active && "drop-shadow-sm")}
                    aria-hidden
                  />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
