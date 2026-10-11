import Link from "next/link";
import { CloudCountryLogo } from "@/components/site/cloudcountry-logo";

const FOOTER_LINKS = [
  { href: "/warnings", label: "Warnings" },
  { href: "/radar", label: "Radar" },
  { href: "/satellite", label: "Satellite" },
  { href: "/forecast", label: "Forecast" },
  { href: "/risk", label: "Risk outlook" },
  { href: "/community", label: "Community" },
] as const;

export function SiteFooter() {
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-white/10">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(7,11,22,0.92), rgba(7,11,22,0.55)), url('https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=1600&q=70')",
        }}
        aria-hidden
      />
      <div className="relative mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-4 lg:px-5">
        <div className="space-y-2">
          <CloudCountryLogo size="sm" />
          <p className="max-w-md text-sm text-white/70">
            Explore Australian radar, lightning activity, forecasts, and severe
            weather information in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-white/75 transition hover:text-[var(--cyan)]"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/forecast"
            className="inline-flex items-center rounded-full bg-[var(--cyan)] px-4 py-2 text-sm font-bold text-[#041018] shadow-[0_0_24px_rgba(34,211,238,0.3)] transition hover:bg-[var(--cyan-soft)]"
          >
            Explore the forecast
          </Link>
        </div>
      </div>
    </footer>
  );
}
