"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteNav } from "@/components/site/site-nav";
import { WarningsBar } from "@/components/site/warnings-bar";
import {
  WarningSeverityBadge,
  warningSeverityClasses,
} from "@/components/warnings/warning-severity";
import {
  formatWarningTime,
  humanizeWarningType,
  type BomWarningDetail,
} from "@/lib/weather/warnings";
import { cn } from "@/lib/utils";

export function WarningDetailPage({ id }: { id: string }) {
  const [warning, setWarning] = useState<BomWarningDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/weather/warnings/${encodeURIComponent(id)}`,
          { signal: ac.signal, cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "This warning is no longer available."
              : `Could not load warning (${res.status})`,
          );
        }
        const data = (await res.json()) as { warning: BomWarningDetail };
        if (ac.signal.aborted) return;
        setWarning(data.warning);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load warning");
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [id]);

  const tone = warning
    ? warningSeverityClasses(warning.severity)
    : warningSeverityClasses("minor");

  return (
    <div className="flex min-h-screen flex-col bg-[var(--page)]">
      <SiteHeader />
      <WarningsBar />
      <SiteNav />
      <main className="mx-auto w-full max-w-[900px] flex-1 px-3 py-6 sm:px-4">
        <Link
          href="/warnings"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All warnings
        </Link>

        {loading ? (
          <p className="text-sm text-white/70">Loading warning…</p>
        ) : null}

        {error ? (
          <div className="border border-white/20 bg-[var(--bom-blue-mid)] p-4">
            <p className="font-bold text-white">Warning unavailable</p>
            <p className="mt-1 text-sm text-white/75">{error}</p>
          </div>
        ) : null}

        {warning ? (
          <article>
            <header className="mb-5 border border-white/15 bg-[var(--bom-blue-mid)] p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <WarningSeverityBadge
                  severity={warning.severity}
                  label={warning.severityLabel}
                />
                <span className="text-xs font-bold uppercase tracking-wide text-white/70">
                  {warning.states.join(" · ") || warning.state}
                </span>
                <span className="text-xs uppercase tracking-wide text-white/45">
                  {warning.phase} · {humanizeWarningType(warning.type)}
                </span>
              </div>
              <div className="flex gap-3">
                <span
                  className={cn(
                    "mt-1 flex h-10 w-10 shrink-0 items-center justify-center",
                    tone.icon,
                  )}
                >
                  <AlertTriangle className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h1 className="text-2xl font-bold text-white">
                    {warning.shortTitle}
                  </h1>
                  <p className="mt-1 text-sm text-white/80">{warning.title}</p>
                  <p className="mt-2 text-xs text-white/55">
                    Product {warning.id}
                    {warning.issueTime
                      ? ` · Issued ${formatWarningTime(warning.issueTime)}`
                      : ""}
                    {warning.expiryTime
                      ? ` · Expires ${formatWarningTime(warning.expiryTime)}`
                      : ""}
                  </p>
                </div>
              </div>
            </header>

            {warning.images.length > 0 ? (
              <section className="mb-5 space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--bom-yellow)]">
                  Warning maps
                </h2>
                {warning.images.map((img, i) => (
                  <figure
                    key={`${warning.id}-img-${i}`}
                    className="overflow-hidden border border-white/15 bg-black"
                  >
                    {/* BoM embeds maps as data URLs or absolute URLs */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.src}
                      alt={img.alt || `${warning.shortTitle} map`}
                      className="mx-auto h-auto max-h-[70vh] w-full object-contain"
                    />
                    {img.alt ? (
                      <figcaption className="border-t border-white/10 px-3 py-2 text-xs text-white/65">
                        {img.alt}
                      </figcaption>
                    ) : null}
                  </figure>
                ))}
              </section>
            ) : null}

            <section className="border border-white/15 bg-[var(--bom-blue-mid)] p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--bom-yellow)]">
                Warning text
              </h2>
              <div
                className="warning-body space-y-3 text-sm leading-relaxed text-white/90 [&_a]:text-[var(--bom-yellow)] [&_a]:underline [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-white [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-white [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-white [&_li]:ml-4 [&_li]:list-disc [&_p]:text-white/90 [&_strong]:text-white"
                dangerouslySetInnerHTML={{ __html: warning.bodyHtml }}
              />
            </section>

            <p className="mt-4 text-xs text-white/50">
              Source:{" "}
              <a
                href={warning.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white/80"
              >
                Bureau of Meteorology
              </a>
              . Always follow official advice for your area.
            </p>
          </article>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
