"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { SiteShell } from "@/components/site/site-shell";
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
    <SiteShell>
      <div className="mx-auto w-full max-w-[820px] px-3 py-5 sm:px-4 sm:py-6">
        <Link
          href="/warnings"
          className="mb-4 inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All warnings
        </Link>

        {loading ? (
          <p className="text-sm text-white/70">Loading warning…</p>
        ) : null}

        {error ? (
          <div className="sw-panel p-4">
            <p className="font-bold text-white">Warning unavailable</p>
            <p className="mt-1 text-sm text-white/75">{error}</p>
          </div>
        ) : null}

        {warning ? (
          <article className="space-y-4">
            <header className="sw-panel p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <WarningSeverityBadge
                  severity={warning.severity}
                  label={warning.severityLabel}
                  className="rounded-md px-2 py-1 text-[11px]"
                />
                <span className="text-xs font-bold uppercase tracking-wide text-white/65">
                  {warning.states.join(" · ") || warning.state}
                </span>
                <span className="text-xs uppercase tracking-wide text-white/40">
                  {warning.phase} · {humanizeWarningType(warning.type)}
                </span>
              </div>
              <div className="flex gap-3">
                <span
                  className={cn(
                    "mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md",
                    tone.icon,
                  )}
                >
                  <AlertTriangle className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold text-white sm:text-2xl">
                    {warning.shortTitle}
                  </h1>
                  <p className="mt-1.5 text-sm leading-snug text-white/75 sm:line-clamp-none line-clamp-4">
                    {warning.title}
                  </p>
                  <dl className="mt-3 grid gap-1.5 text-xs text-white/55 sm:grid-cols-2">
                    <div>
                      <dt className="inline text-white/40">Product </dt>
                      <dd className="inline text-white/70">{warning.id}</dd>
                    </div>
                    {warning.issueTime ? (
                      <div>
                        <dt className="inline text-white/40">Issued </dt>
                        <dd className="inline text-white/70">
                          {formatWarningTime(warning.issueTime)}
                        </dd>
                      </div>
                    ) : null}
                    {warning.expiryTime ? (
                      <div>
                        <dt className="inline text-white/40">Expires </dt>
                        <dd className="inline text-white/70">
                          {formatWarningTime(warning.expiryTime)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </div>
            </header>

            {warning.images.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                  Warning maps
                </h2>
                {warning.images.map((img, i) => (
                  <figure
                    key={`${warning.id}-img-${i}`}
                    className="overflow-hidden rounded-lg border border-white/12 bg-black"
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

            <section className="sw-panel p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                Warning text
              </h2>
              <div
                className="warning-body"
                dangerouslySetInnerHTML={{ __html: warning.bodyHtml }}
              />
            </section>

            <p className="text-xs text-white/45">
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
      </div>
    </SiteShell>
  );
}
