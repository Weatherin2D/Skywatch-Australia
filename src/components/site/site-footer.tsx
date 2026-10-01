import Link from "next/link";
import { SkyWatchLogo } from "@/components/site/skywatch-logo";

const FOOTER_LINKS = [
  { href: "/warnings", label: "Warnings" },
  { href: "/forecast", label: "Forecast" },
  { href: "/risk", label: "Risk outlook" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-[var(--navy-deep)]/40 text-[var(--ink)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-5">
        <SkyWatchLogo size="sm" />
        <p className="text-center text-[11px] text-[var(--ink)]/60 sm:text-xs">
          Bureau of Meteorology data · Supporting a more weather aware Australia
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-semibold sm:justify-end sm:text-sm">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-white/80 hover:text-white hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
