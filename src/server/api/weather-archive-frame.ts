import { NextRequest, NextResponse } from "next/server";
import { ensureArchiveSatFrame } from "@/lib/weather/archive-sat";
import { getSatFrame, putSatFrame } from "@/lib/weather/archive-storage";
import { quantizeArchiveStamp } from "@/lib/weather/archive-time";
import { fetchAndCacheFrameResilient } from "@/lib/weather/fetch-frame";
import { GIBS_AU_BOUNDS } from "@/lib/weather/maps";
import {
  isSatelliteProductId,
  type SatelliteProductId,
} from "@/lib/weather/maps";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

async function liveJpeg(
  product: SatelliteProductId,
  time: number,
): Promise<Buffer | null> {
  try {
    const got = await fetchAndCacheFrameResilient(
      product,
      time,
      GIBS_AU_BOUNDS,
      "national",
    );
    if (!got) return null;
    return sharp(got.body)
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

function jpegResponse(
  body: Buffer,
  capture: "0" | "1" | "live-fallback",
): NextResponse {
  const maxAge =
    capture === "0" ? 86_400 : capture === "1" ? 300 : 120;
  const immutable = capture === "0" ? ", immutable" : "";
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": `public, max-age=${maxAge}${immutable}`,
      "X-Archive-Capture": capture,
    },
  });
}

/**
 * GET /api/weather/archive/frame?product=&time=
 * Serves stored JPEG; on miss races live encode vs archive capture so the
 * UI never waits on a cold serverless persist.
 */
export async function GET(request: NextRequest) {
  const productRaw = request.nextUrl.searchParams.get("product") ?? "";
  const timeRaw = request.nextUrl.searchParams.get("time") ?? "";
  const time = Number(timeRaw);
  if (!isSatelliteProductId(productRaw) || !Number.isFinite(time)) {
    return NextResponse.json({ error: "Invalid product or time" }, { status: 400 });
  }
  const product = productRaw as SatelliteProductId;
  const stamp = quantizeArchiveStamp(Math.floor(time));
  try {
    const cached = await getSatFrame(product, stamp);
    if (cached) return jpegResponse(cached, "0");

    // Race archive capture against a direct live encode. Whichever finishes
    // first wins the response; the other still runs to warm durable storage.
    const capturePromise = ensureArchiveSatFrame(product, stamp).catch(
      () => null,
    );
    const livePromise = liveJpeg(product, stamp).catch(() => null);

    const first = await Promise.race([
      capturePromise.then((got) =>
        got ? ({ kind: "archive" as const, got }) : null,
      ),
      livePromise.then((body) =>
        body ? ({ kind: "live" as const, body }) : null,
      ),
    ]);

    if (first?.kind === "archive") {
      return jpegResponse(
        first.got.body,
        first.got.captured ? "1" : "0",
      );
    }
    if (first?.kind === "live") {
      // Persist in the background so the next scrub hit is a Redis cache hit.
      void putSatFrame(product, stamp, first.body).catch((err) => {
        console.warn("[weather/archive/frame] background persist", err);
      });
      // Let the archive path finish too (deduped inside ensureArchiveSatFrame).
      void capturePromise;
      return jpegResponse(first.body, "live-fallback");
    }

    // Both raced to empty — await whichever might still succeed.
    const [captured, live] = await Promise.all([capturePromise, livePromise]);
    if (captured) {
      return jpegResponse(captured.body, captured.captured ? "1" : "0");
    }
    if (live) {
      void putSatFrame(product, stamp, live).catch(() => undefined);
      return jpegResponse(live, "live-fallback");
    }

    return NextResponse.json(
      { error: "Not archived yet" },
      { status: 404 },
    );
  } catch (err) {
    console.error("[weather/archive/frame]", err);
    return NextResponse.json({ error: "Frame unavailable" }, { status: 500 });
  }
}
