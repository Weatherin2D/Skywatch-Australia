import Link from "next/link";
import { SiteShell } from "@/components/site/site-shell";
import { MORE_NAV } from "@/components/site/nav-config";

export default function MorePage() {
  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold text-white">
            More
          </h1>
          <p className="mt-1 text-white/60">
            Extra SkyWatch tools and outlooks.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {MORE_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm font-semibold text-white transition hover:border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/10"
              >
                {item.label}
                <span className="text-[var(--cyan)]">Open</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/warnings"
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm font-semibold text-white transition hover:border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/10"
            >
              Warnings
              <span className="text-[var(--cyan)]">Open</span>
            </Link>
          </li>
        </ul>
      </div>
    </SiteShell>
  );
}
