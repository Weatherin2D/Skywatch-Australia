import Link from "next/link";
import { SiteShell } from "@/components/site/site-shell";

const CARDS = [
  {
    title: "Storm profiles",
    blurb:
      "Explore forecast conditions at different heights in the atmosphere. Compare the forecast with weather-balloon observations.",
    href: "/soundings?mode=model&engine=predict&model=pulse&lat=-31.95&lon=115.86&place=Perth",
    cta: "Explore storm profiles",
  },
  {
    title: "Forecast models",
    blurb:
      "Explore weather forecasts on a map and compare conditions at different locations.",
    href: "/models?model=icon&skewt=1&engine=predict&lat=-31.95&lon=115.86",
    cta: "Explore forecast models",
  },
  {
    title: "Thunderstorm outlook",
    blurb:
      "View estimated thunderstorm risk areas and the weather conditions behind them. These estimates are not official warnings.",
    href: "/risk?source=pulse&engine=predict",
    cta: "View thunderstorm outlook",
  },
] as const;

export default function AiHubPage() {
  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-3xl space-y-6 px-3 py-8 sm:px-4">
        <header className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
            Experimental tools
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold text-white sm:text-4xl">
            Weather insights in development
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/65">
            Try experimental tools for exploring storm conditions and forecast
            risk. Results may be incomplete and should not replace official
            Bureau of Meteorology warnings.
          </p>
        </header>

        <ul className="space-y-3">
          {CARDS.map((card) => (
            <li
              key={card.href}
              className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4"
            >
              <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-white">
                {card.title}
              </h2>
              <p className="mt-1 text-sm text-white/65">{card.blurb}</p>
              <Link
                href={card.href}
                className="mt-3 inline-flex rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-[#070b16] hover:bg-amber-300"
              >
                {card.cta}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </SiteShell>
  );
}
