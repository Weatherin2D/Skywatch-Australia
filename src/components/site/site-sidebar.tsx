"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, SECONDARY_NAV } from "@/components/site/nav-config";
import { cn } from "@/lib/utils";

export function SiteSidebar() {
  const pathname = usePathname();
  const items = [...PRIMARY_NAV, ...SECONDARY_NAV];

  return (
    <aside
      aria-label="Quick navigation"
      className="sticky top-[7.25rem] z-30 hidden h-[calc(100vh-7.25rem)] w-[4.75rem] shrink-0 flex-col border-r border-white/10 bg-[#070b16]/85 py-3 backdrop-blur-xl xl:flex"
    >
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-1.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] font-semibold transition",
                  active
                    ? "bg-[var(--cyan)]/12 text-[var(--cyan)] shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]"
                    : "text-white/55 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="pointer-events-none h-5 w-5" aria-hidden />
                <span className="pointer-events-none leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
