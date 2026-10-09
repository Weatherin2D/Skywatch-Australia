"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  {
    href: "/soundings?mode=model&engine=predict&model=pulse&lat=-31.95&lon=115.86&place=Perth",
    label: "AI Soundings",
  },
  {
    href: "/models?model=icon&skewt=1&engine=predict&lat=-31.95&lon=115.86",
    label: "AI Models",
  },
  {
    href: "/risk?source=pulse&engine=predict",
    label: "AI Risk",
  },
] as const;

/** Persistent strip so Engine / AI V1 entry points are obvious. */
export function AiLiveBanner() {
  const pathname = usePathname();
  if (pathname === "/ai") return null;

  return (
    <div className="border-b border-amber-400/30 bg-amber-400/[0.08]">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:px-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">
          SkyWatch AI V1
        </p>
        <p className="text-xs text-white/65">
          Use the amber <span className="font-semibold text-amber-200">AI V1</span>{" "}
          control — Model soundings (not Observed). Use this live host (Vercel Hobby is offline).
        </p>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-400/25"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/ai"
            className="rounded-md border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-white/80 hover:text-white"
          >
            AI hub
          </Link>
        </div>
      </div>
    </div>
  );
}
