import Link from "next/link";
import {
  CloudLightning,
  CloudRain,
  CloudSun,
  Siren,
} from "lucide-react";

const FEATURES = [
  { href: "/radar", label: "Real-time radar", icon: CloudRain },
  { href: "/satellite", label: "Lightning tracking", icon: CloudLightning },
  { href: "/forecast", label: "Forecasts & models", icon: CloudSun },
  { href: "/warnings", label: "Severe weather alerts", icon: Siren },
] as const;

export function HomeHero() {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
      <div
        className="animate-hero-drift absolute inset-0 bg-cover bg-[center_35%]"
        style={{
          backgroundImage: "url('/images/hero-storm.jpg')",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-[#070b16]/88 via-[#070b16]/55 to-transparent"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-t from-[#070b16] via-[#070b16]/30 to-[#070b16]/15"
        aria-hidden
      />

      <div className="relative flex min-h-[240px] flex-col justify-end gap-4 px-5 py-7 sm:min-h-[280px] sm:px-8 sm:py-9 lg:min-h-[320px]">
        <p className="animate-fade-up font-[family-name:var(--font-display)] text-xs font-bold uppercase tracking-[0.28em] text-[var(--cyan)] drop-shadow-[0_0_18px_rgba(34,211,238,0.45)]">
          Thunderstate
        </p>
        <div className="animate-fade-up-delay max-w-md space-y-3 sm:max-w-lg">
          <h1 className="sw-hero-title font-[family-name:var(--font-display)] text-[3.4rem] font-bold uppercase leading-[0.88] sm:text-[4.25rem] lg:text-[5.1rem]">
            <span className="block whitespace-nowrap">Live weather</span>
            <span className="block whitespace-nowrap">across the</span>
            <span className="block whitespace-nowrap">continent</span>
          </h1>
          <p className="max-w-xl text-sm text-white/80 sm:text-base">
            Radar, lightning, satellite loops and forecasts — built for a safer
            Australia.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {FEATURES.map(({ href, label, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md transition hover:border-[var(--cyan)]/50 hover:bg-[var(--cyan)]/15 hover:text-[var(--cyan)]"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
