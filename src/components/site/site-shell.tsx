"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteSidebar } from "@/components/site/site-sidebar";
import { WarningsBar } from "@/components/site/warnings-bar";
import { MOBILE_NAV } from "@/components/site/nav-config";
import { cn } from "@/lib/utils";

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
      <div className="mx-auto flex w-full max-w-[1680px] flex-1">
        <SiteSidebar />
        <main className={cn("min-w-0 flex-1 pb-20 xl:pb-0", mainClassName)}>
          {children}
        </main>
      </div>
      <SiteFooter />

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#0a1224]/92 backdrop-blur-xl xl:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : href === "/more"
                  ? ["/archive", "/models", "/climate", "/risk", "/hazards", "/warnings", "/more"].some(
                      (p) => pathname === p || pathname.startsWith(`${p}/`),
                    )
                  : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-semibold transition",
                    active
                      ? "text-[var(--cyan)]"
                      : "text-white/55 hover:text-white",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
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
