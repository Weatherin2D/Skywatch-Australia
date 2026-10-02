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
        className="animate-hero-drift absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1526653054275-5a4f37ea1c64?auto=format&fit=crop&w=1800&q=75')",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-[#070b16] via-[#070b16]/82 to-[#070b16]/35"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-t from-[#070b16] via-transparent to-[#070b16]/40"
        aria-hidden
      />

      <div className="relative flex min-h-[220px] flex-col justify-end gap-4 px-5 py-7 sm:min-h-[260px] sm:px-8 sm:py-9 lg:min-h-[300px]">
        <p className="animate-fade-up font-[family-name:var(--font-display)] text-xs font-bold uppercase tracking-[0.22em] text-[var(--cyan)]">
          SkyWatch Australia
        </p>
        <div className="animate-fade-up-delay max-w-2xl space-y-2">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Live weather across the continent
          </h1>
          <p className="max-w-xl text-sm text-white/75 sm:text-base">
            Radar, lightning, satellite loops and forecasts — built for a safer
            Australia.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {FEATURES.map(({ href, label, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md transition hover:border-[var(--cyan)]/50 hover:bg-[var(--cyan)]/15 hover:text-[var(--cyan)]"
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
