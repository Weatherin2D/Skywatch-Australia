import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SATELLITE_PRODUCT,
  GIBS_AU_BOUNDS,
  HIMAWARI_STEP_SEC,
  SATELLITE_FRAME_COUNT,
  SATELLITE_PRODUCTS,
  buildContiguousTimeline,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
  isSatelliteProductId,
  parseRealEarthTimeToken,
  satelliteFrameProxyUrl,
  toIsoZ,
  type SatelliteProductId,
  type SatelliteProductMeta,
  type WeatherFrame,
  type WeatherMapsPayload,
} from "@/lib/weather/maps";
import { warmFramesInBackground } from "@/lib/weather/fetch-frame";
import {
  BOM_RADAR_ATTRIBUTION,
  bomRadarTileUrl,
  getBomRadarFrameTimes,
  isoTimeFromUnix,
} from "@/lib/weather/bom-radar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GIBS_STEP_MS = HIMAWARI_STEP_SEC * 1000;
const GIBS_PROBE_MAX = 18;
const GIBS_PROBE_BATCH = 4;
const GIBS_PROBE_WIDTH = 96;
const FRAME_COUNT = SATELLITE_FRAME_COUNT;

function emptyProductFrames(): WeatherMapsPayload["satellite"]["products"] {
  return Object.fromEntries(
    SATELLITE_PRODUCTS.map((p) => [p.id, { frames: [] as WeatherFrame[] }]),
  ) as WeatherMapsPayload["satellite"]["products"];
}

/** Fast content probe using a tiny WMS render instead of the full frame. */
async function probeGibsWms(
  isoTime: string,
  product: SatelliteProductId,
): Promise<boolean> {
  try {
    const res = await fetch(
      gibsHimawariWmsUrl(isoTime, product, { width: GIBS_PROBE_WIDTH }),
      {
        method: "GET",
        headers: { "User-Agent": "SkyWatchAustralia/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("image")) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    // Tiny empty GIBS stubs are often ~1–3KB even at probe width; real crops are denser.
    if (buf.length < 4_000) return false;
    let nonBlack = 0;
    for (let i = 40; i < Math.min(buf.length, 2500); i += 11) {
      if (buf[i]! > 16) nonBlack += 1;
    }
    return nonBlack >= 10;
  } catch {
    return false;
  }
}

/** When NASA probing fails (timeouts / egress blips), still offer a loop. */
function fallbackLatestMs(): number {
  // RealEarth tip is typically ~15–30 min behind wall clock.
  const lagMs = 20 * 60 * 1000;
  return Math.floor((Date.now() - lagMs) / GIBS_STEP_MS) * GIBS_STEP_MS;
}

async function findLatestGibsTime(
  product: SatelliteProductId,
): Promise<number | null> {
  const latestMs = Math.floor(Date.now() / GIBS_STEP_MS) * GIBS_STEP_MS;
  const candidates: number[] = [];
  // Probe from the current slot — unpublished tips fail the content gate.
  for (let i = 0; i < GIBS_PROBE_MAX; i++) {
    candidates.push(latestMs - i * GIBS_STEP_MS);
  }

  for (let start = 0; start < candidates.length; start += GIBS_PROBE_BATCH) {
    const batch = candidates.slice(start, start + GIBS_PROBE_BATCH);
    const results = await Promise.all(
      batch.map(async (ms) =>
        (await probeGibsWms(toIsoZ(ms), product)) ? ms : null,
      ),
    );
    const hit = results.find((ms) => ms != null);
    if (hit != null) return hit;
  }
  return null;
}

async function fetchRealEarthTimes(
  realearthProduct: string,
  count = FRAME_COUNT,
): Promise<number[]> {
  try {
    const res = await fetch(
      `https://realearth.ssec.wisc.edu/api/products?products=${encodeURIComponent(realearthProduct)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "SkyWatchAustralia/1.0",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ times?: string[] }>;
    const tokens = data[0]?.times ?? [];
    const parsed = tokens
      .map(parseRealEarthTimeToken)
      .filter((t) => Number.isFinite(t) && t > 0) as number[];
    if (parsed.length === 0) return [];
    return parsed.slice(-count);
  } catch {
    return [];
  }
}

function buildFramesFromTimes(
  product: SatelliteProductId,
  timesUnix: number[],
): WeatherFrame[] {
  return timesUnix.map((time) => ({
    time,
    imageUrl: satelliteFrameProxyUrl(product, time),
    imageBounds: GIBS_AU_BOUNDS,
  }));
}

function buildFramesAtLatest(
  product: SatelliteProductId,
  latestMs: number,
  count = FRAME_COUNT,
): WeatherFrame[] {
  return buildFramesFromTimes(
    product,
    buildContiguousTimeline(Math.floor(latestMs / 1000), count),
  );
}

async function buildBomRadarFrames(): Promise<WeatherFrame[]> {
  try {
    const times = await getBomRadarFrameTimes();
    return times.map((time) => ({
      time,
      tileUrlTemplate: bomRadarTileUrl(isoTimeFromUnix(time)),
      radarSource: "bom" as const,
    }));
  } catch (err) {
    console.error("[weather/maps] BoM radar frames failed", err);
    return [];
  }
}

async function buildProductFrames(
  meta: SatelliteProductMeta,
  sharedTimelineUnix: number[] | null,
  fallbackLatestMs: number | null,
): Promise<WeatherFrame[]> {
  if (sharedTimelineUnix && sharedTimelineUnix.length >= 3) {
    return buildFramesFromTimes(meta.id, sharedTimelineUnix);
  }

  if (meta.realearthProduct) {
    const native = await fetchRealEarthTimes(meta.realearthProduct, FRAME_COUNT);
    if (native.length >= 3) {
      const tip = native[native.length - 1]!;
      return buildFramesFromTimes(
        meta.id,
        buildContiguousTimeline(tip, FRAME_COUNT),
      );
    }
  }

  if (fallbackLatestMs != null) {
    return buildFramesAtLatest(meta.id, fallbackLatestMs);
  }
  return [];
}

/**
 * Shared RealEarth-led Himawari spine (contiguous 10-minute stamps).
 * GIBS is only a tip/fallback — never thin the loop to RainViewer radar.
 */
async function buildAllSatelliteProducts(): Promise<{
  products: WeatherMapsPayload["satellite"]["products"];
  source: WeatherMapsPayload["satellite"]["source"];
}> {
  const products = emptyProductFrames();

  const infraredMeta = getSatelliteProduct("infrared");
  const infraredTimes =
    infraredMeta.realearthProduct != null
      ? await fetchRealEarthTimes(infraredMeta.realearthProduct, FRAME_COUNT)
      : [];

  const gibsLatestMs =
    infraredTimes.length >= 3
      ? null
      : ((await findLatestGibsTime("infrared")) ??
        (await findLatestGibsTime("airmass")) ??
        (await findLatestGibsTime("visible")) ??
        fallbackLatestMs());

  const tipUnix =
    infraredTimes.length >= 3
      ? infraredTimes[infraredTimes.length - 1]!
      : Math.floor((gibsLatestMs ?? fallbackLatestMs()) / 1000);

  const sharedTimeline = buildContiguousTimeline(tipUnix, FRAME_COUNT);

  const built = await Promise.all(
    SATELLITE_PRODUCTS.map(async (meta) => {
      const frames = await buildProductFrames(
        meta,
        sharedTimeline,
        gibsLatestMs ?? tipUnix * 1000,
      );
      return [meta.id, frames] as const;
    }),
  );

  for (const [id, frames] of built) {
    products[id] = { frames };
  }

  // Warm only the newest few IR frames — full-loop warm burned Fluid CPU.
  if (products.infrared.frames.length) {
    const tipTimes = products.infrared.frames
      .map((f) => f.time)
      .slice(-3);
    warmFramesInBackground("infrared", tipTimes, 1);
  }

  return {
    products,
    source: infraredTimes.length >= 3 ? "realearth-himawari" : "gibs-himawari",
  };
}

export async function GET(request: NextRequest) {
  try {
    const rawProduct = request.nextUrl.searchParams.get("product") ?? "";
    const wantAll =
      rawProduct === "all" ||
      rawProduct === "" ||
      request.nextUrl.searchParams.get("all") === "1";
    const product: SatelliteProductId = isSatelliteProductId(rawProduct)
      ? rawProduct
      : DEFAULT_SATELLITE_PRODUCT;

    const bomFrames = await buildBomRadarFrames();
    const radarAll = bomFrames;
    const host = "https://api.bom.gov.au";

    const satellite = wantAll
      ? await buildAllSatelliteProducts()
      : await (async () => {
          const products = emptyProductFrames();
          const meta = getSatelliteProduct(product);
          const native = meta.realearthProduct
            ? await fetchRealEarthTimes(meta.realearthProduct, FRAME_COUNT)
            : [];
          const gibsLatestMs =
            native.length >= 3
              ? null
              : ((await findLatestGibsTime(
                  meta.id === "visible" ? "infrared" : meta.id,
                )) ?? fallbackLatestMs());
          const tipUnix =
            native.length >= 3
              ? native[native.length - 1]!
              : Math.floor((gibsLatestMs ?? fallbackLatestMs()) / 1000);
          products[product] = {
            frames: await buildProductFrames(
              meta,
              buildContiguousTimeline(tipUnix, FRAME_COUNT),
              gibsLatestMs ?? tipUnix * 1000,
            ),
          };
          return {
            products,
            source:
              native.length >= 3
                ? ("realearth-himawari" as const)
                : ("gibs-himawari" as const),
          };
        })();

    const generated = Math.floor(Date.now() / 1000);
    const activeProduct = wantAll ? DEFAULT_SATELLITE_PRODUCT : product;
    const frames = satellite.products[activeProduct].frames;
    const activeMeta = getSatelliteProduct(activeProduct);

    const payload: WeatherMapsPayload = {
      generated,
      host,
      satellite: {
        product: activeProduct,
        source: satellite.source,
        frames,
        products: satellite.products,
      },
      radar: {
        past: radarAll,
        source: "bom",
        attribution: BOM_RADAR_ATTRIBUTION,
      },
    };

    return NextResponse.json(payload, {
      headers: {
        // Tip advances every ~10 min — 60s CDN still feels live, cuts origin hits.
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "X-Satellite-Product": wantAll ? "all" : product,
        "X-Satellite-Layer":
          activeMeta.realearthProduct ?? activeMeta.gibsLayer ?? activeProduct,
        "X-Satellite-Source": satellite.source,
        "X-Satellite-Latest": frames.length
          ? String(frames[frames.length - 1]!.time)
          : "",
        "X-Satellite-Frame-Count": String(frames.length),
        "X-Radar-Source": "bom",
        "X-Radar-Bom-Frames": String(radarAll.length),
        "X-Radar-Frame-Count": String(radarAll.length),
      },
    });
  } catch (error) {
    console.error("[weather/maps]", error);
    return NextResponse.json(
      { error: "Failed to load weather maps" },
      { status: 502 },
    );
  }
}
