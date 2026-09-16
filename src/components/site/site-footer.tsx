import Link from "next/link";
import { SkyWatchLogo } from "@/components/site/skywatch-logo";

const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/data-sources", label: "Data Sources" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/contact", label: "Contact" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--border)] bg-[var(--navy)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <SkyWatchLogo size="sm" />
        <p className="text-center text-xs text-[var(--muted-foreground)] sm:text-sm">
          Bureau of Meteorology data · Supporting a more weather aware Australia
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[var(--muted-foreground)] transition hover:text-white"
            >
              {link.label}
            </Link>
          ))}
          <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
            <span aria-hidden className="text-xs">
              YT
            </span>
            <span aria-hidden className="text-xs">
              X
            </span>
            <span aria-hidden className="text-xs">
              DC
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}
