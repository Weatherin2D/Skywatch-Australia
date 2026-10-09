import Link from "next/link";
import { SiteShell } from "@/components/site/site-shell";

const CARDS = [
  {
    title: "AI Soundings",
    blurb:
      "Model Skew-T with SkyWatch AI V1 neural residual (Open-Meteo teacher). Skip Observed while UWYO is down.",
    href: "/soundings?mode=model&engine=predict&model=pulse&lat=-31.95&lon=115.86&place=Perth",
    cta: "Open AI V1 sounding",
  },
  {
    title: "AI Models",
    blurb:
      "National model map with mini Skew-T. AI V1 and Skew-T turn on from this link — click the map near land.",
    href: "/models?model=icon&skewt=1&engine=predict&lat=-31.95&lon=115.86",
    cta: "Open AI Models",
  },
  {
    title: "AI Risk",
    blurb:
      "Pulse risk outlook. Tap a coloured area — the inspect panel shows SkyWatch AI thermo (CAPE, shear, SRH).",
    href: "/risk?source=pulse&engine=predict",
    cta: "Open AI Risk",
  },
] as const;

export default function AiHubPage() {
  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-3xl space-y-6 px-3 py-8 sm:px-4">
        <header className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
            Local AI demo
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold text-white sm:text-4xl">
            SkyWatch AI V1
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/65">
            The Hobby production host (ausrisk.vercel.app) is disabled by Vercel
            fair-use limits. Use these links on this live tunnel — each one opens
            with <span className="font-semibold text-amber-200">AI V1</span>{" "}
            already selected.
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
