"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteShell } from "@/components/site/site-shell";
import { CellDetailsPanel } from "@/components/home/cell-details-panel";
import type {
  StormCell,
  StormCellsPayload,
} from "@/lib/weather/storm-cell-types";

export function AutoCellDetailPage({ cellId }: { cellId: string }) {
  const [cell, setCell] = useState<StormCell | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void fetch("/api/weather/storm-cells", {
      cache: "no-store",
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Unavailable (${res.status})`);
        return (await res.json()) as StormCellsPayload;
      })
      .then((json) => {
        if (ac.signal.aborted) return;
        setNote(json.note ?? null);
        const hit = json.cells.find((c) => c.id === cellId) ?? null;
        setCell(hit);
        setLoading(false);
        if (!hit) setError("This cell is no longer active.");
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : "Unavailable");
      });
    return () => ac.abort();
  }, [cellId]);

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[720px] space-y-4 px-3 py-5 sm:px-4 sm:py-6">
        <div>
          <Link
            href="/warnings?source=auto"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cyan)] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Automated alerts
          </Link>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
            StormFront Australia estimate
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white">
            Thunderstorm cell
          </h1>
        </div>

        {loading ? (
          <p className="text-sm text-white/65">Loading cell analysis…</p>
        ) : null}
        {error && !cell ? (
          <div className="sw-panel space-y-3 p-4">
            <p className="text-sm text-white/85">{error}</p>
            <Link
              href="/radar?chase=1"
              className="inline-flex text-xs font-semibold text-[var(--cyan)] hover:underline"
            >
              Open active cell tracker
            </Link>
          </div>
        ) : null}
        {cell ? <CellDetailsPanel cell={cell} /> : null}
        {note ? <p className="text-[11px] text-white/40">{note}</p> : null}
      </div>
    </SiteShell>
  );
}
