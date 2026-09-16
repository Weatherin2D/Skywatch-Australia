import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteNav } from "@/components/site/site-nav";
import { SkyWatchLogo } from "@/components/site/skywatch-logo";

export default function ComingSoonPage({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--navy-deep)]">
      <SiteHeader />
      <SiteNav />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-5 py-16 text-center">
        <SkyWatchLogo showWordmark={false} size="lg" />
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-white sm:text-4xl">
          {title}
        </h1>
        <p className="max-w-lg text-[var(--muted-foreground)]">{blurb}</p>
        <p className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-4 py-1.5 text-xs uppercase tracking-[0.18em] text-[var(--sky)]">
          Coming soon
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
