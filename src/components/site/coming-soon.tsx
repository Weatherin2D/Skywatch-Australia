import { SiteShell } from "@/components/site/site-shell";
import { CloudCountryLogo } from "@/components/site/cloudcountry-logo";
import Link from "next/link";

export default function ComingSoonPage({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <SiteShell>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-5 px-5 py-16 text-center">
        <CloudCountryLogo showWordmark={false} size="lg" />
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold text-white sm:text-4xl">
          {title}
        </h1>
        <p className="max-w-lg text-white/65">{blurb}</p>
        <p className="rounded-full border border-[var(--cyan)]/40 bg-[var(--cyan)]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--cyan)]">
          Coming soon
        </p>
        <Link
          href="/"
          className="text-sm font-semibold text-white/70 underline-offset-4 hover:text-[var(--cyan)] hover:underline"
        >
          Back to home
        </Link>
      </div>
    </SiteShell>
  );
}
