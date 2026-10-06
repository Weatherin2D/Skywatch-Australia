"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site/site-shell";
import { MORE_NAV, PRIMARY_NAV_END } from "@/components/site/nav-config";

export default function MorePage() {
  const [installHint, setInstallHint] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      ("standalone" in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const mobile = window.matchMedia("(max-width: 768px)").matches;
    setInstallHint(mobile && !isStandalone);
  }, []);

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

        {installHint ? (
          <div className="rounded-2xl border border-[var(--cyan)]/30 bg-[var(--cyan)]/10 px-4 py-3 text-sm text-white/80">
            <p className="font-semibold text-[var(--cyan)]">Install SkyWatch</p>
            <p className="mt-1 text-xs text-white/65">
              Add to your home screen for a full-screen app and offline last
              radar/satellite frame. On iOS: Share → Add to Home Screen. On
              Android: browser menu → Install app.
            </p>
          </div>
        ) : null}

        <ul className="grid gap-3 sm:grid-cols-2">
          {PRIMARY_NAV_END.map((item) => (
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
