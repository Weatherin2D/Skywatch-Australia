import Link from "next/link";
import { SkyWatchLogo } from "@/components/site/skywatch-logo";

const FOOTER_LINKS = [
  { href: "/forecast", label: "Forecast" },
  { href: "/risk", label: "Risk outlook" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-4 border-[var(--bom-blue)] bg-[var(--page)] text-[var(--ink)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <SkyWatchLogo size="sm" />
        <p className="text-center text-xs text-[var(--ink)]/70 sm:text-sm">
          Bureau of Meteorology data · Supporting a more weather aware Australia
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
