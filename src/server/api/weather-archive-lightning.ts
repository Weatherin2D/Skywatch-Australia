import { NextRequest, NextResponse } from "next/server";
import {
  ensureArchiveMeta,
  getLightningRange,
  hourStartAestUnix,
  mergeLightningHour,
} from "@/lib/weather/archive-storage";
import { getLiveLightningSnapshot } from "@/lib/weather/blitzortung-feed";
import { LIGHTNING_VISIBLE_WINDOW_SEC } from "@/lib/weather/lightning";
import type { LightningStrike } from "@/lib/weather/lightning";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

function mergeById(
  a: LightningStrike[],
  b: LightningStrike[],
): LightningStrike[] {
  const map = new Map<string, LightningStrike>();
  for (const s of a) map.set(s.id, s);
  for (const s of b) map.set(s.id, s);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/**
 * GET /api/weather/archive/lightning?from=&to=
 * Combines stored archive hours with the live buffer (and persists new strikes).
 */
export async function GET(request: NextRequest) {
  const fromRaw = request.nextUrl.searchParams.get("from");
  const toRaw = request.nextUrl.searchParams.get("to");
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return NextResponse.json({ error: "Invalid from/to" }, { status: 400 });
  }
  try {
    const meta = await ensureArchiveMeta();
    const lo = Math.max(meta.epochUnix, Math.floor(from));
    const hi = Math.floor(to);
    if (hi < meta.epochUnix) {
      return NextResponse.json({
        generated: Math.floor(Date.now() / 1000),
        source: "archive",
        strikes: [],
        attribution:
          "Lightning © Blitzortung.org / LightningMaps.org (CC BY-SA) — entertainment only",
        windowMinutes: Math.round(LIGHTNING_VISIBLE_WINDOW_SEC / 60),
      });
    }

    let archived = await getLightningRange(lo, hi);

    // Fill gaps from the live 24h buffer and persist into archive hours.
    try {
      const live = await getLiveLightningSnapshot();
      const inRange = live.strikes.filter(
        (s) => s.time >= lo && s.time <= hi + 120,
      );
      if (inRange.length > 0) {
        const before = archived.length;
        archived = mergeById(archived, inRange);
        if (archived.length > before) {
          const byHour = new Map<number, LightningStrike[]>();
          for (const s of inRange) {
            const h = hourStartAestUnix(s.time);
            const list = byHour.get(h) ?? [];
            list.push(s);
            byHour.set(h, list);
          }
          await Promise.all(
            [...byHour.entries()].map(([h, strikes]) =>
              mergeLightningHour(h, strikes).catch(() => 0),
            ),
          );
        }
      }
    } catch (err) {
      console.error("[weather/archive/lightning] live merge", err);
    }

    return NextResponse.json(
      {
        generated: Math.floor(Date.now() / 1000),
        source: "archive+live",
        from: lo,
        to: hi,
        strikes: archived,
        attribution:
          "Lightning © Blitzortung.org / LightningMaps.org (CC BY-SA) — entertainment only, not for official warning use",
        windowMinutes: Math.round(LIGHTNING_VISIBLE_WINDOW_SEC / 60),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
        },
      },
    );
  } catch (err) {
    console.error("[weather/archive/lightning]", err);
    return NextResponse.json(
      { error: "Archive lightning unavailable" },
      { status: 500 },
    );
  }
}
