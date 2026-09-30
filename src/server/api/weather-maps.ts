import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SATELLITE_PRODUCT,
  GIBS_AU_BOUNDS,
  SATELLITE_PRODUCTS,
  alignTimesToRadar,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
  isSatelliteProductId,
  parseRealEarthTimeToken,
  rainviewerTileUrl,
  satelliteFrameProxyUrl,
  toIsoZ,
  trimFramesToRadarWindow,
  type SatelliteProductId,
  type SatelliteProductMeta,
  type WeatherFrame,
  type WeatherMapsPayload,
} from "@/lib/weather/maps";
import { warmFramesInBackground } from "@/lib/weather/fetch-frame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAINVIEWER_URL = "https://api.rainviewer.com/public/weather-maps.json";
const GIBS_STEP_MS = 10 * 60 * 1000;
const GIBS_STEP_SEC = 10 * 60;
const GIBS_PROBE_MAX = 12;
const GIBS_PROBE_BATCH = 4;
const GIBS_PROBE_WIDTH = 96;
const FRAME_COUNT = 18;

type RainViewerMaps = {
  generated?: number;
  host?: string;
  radar?: {
    past?: Array<{ time: number; path: string }>;
    nowcast?: Array<{ time: number; path: string }>;
  };
  satellite?: {
    infrared?: Array<{ time: number; path: string }>;
  };
};

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
    if (buf.length < 600) return false;
    let nonBlack = 0;
    for (let i = 40; i < Math.min(buf.length, 2500); i += 11) {
      if (buf[i]! > 16) nonBlack += 1;
    }
    return nonBlack >= 6;
  } catch {
    return false;
  }
}

/** When NASA probing fails (timeouts / egress blips), still offer a loop. */
function fallbackGibsLatestMs(): number {
  // Himawari via GIBS is typically 40–90 minutes behind wall clock.
  const lagMs = 70 * 60 * 1000;
  return Math.floor((Date.now() - lagMs) / GIBS_STEP_MS) * GIBS_STEP_MS;
}

async function findLatestGibsTime(
  product: SatelliteProductId,
): Promise<number | null> {
  const latestMs = Math.floor(Date.now() / GIBS_STEP_MS) * GIBS_STEP_MS;
  const candidates: number[] = [];
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
  const times: number[] = [];
  for (let i = count - 1; i >= 0; i--) {
    times.push(Math.floor((latestMs - i * GIBS_STEP_MS) / 1000));
  }
  return buildFramesFromTimes(product, times);
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
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ times?: string[] }>;
    const tokens = data[0]?.times ?? [];
    const parsed = tokens
      .map(parseRealEarthTimeToken)
      .filter((t) => Number.isFinite(t) && t > 0);
    if (parsed.length === 0) return [];
    return parsed.slice(-count);
  } catch {
    return [];
  }
}

function normalizeRainviewerFrames(
  host: string,
  frames: Array<{ time: number; path: string }> | undefined,
  kind: "satellite" | "radar",
): WeatherFrame[] {
  if (!frames?.length) return [];
  return frames.map((f) => ({
    time: f.time,
    path: f.path,
    tileUrlTemplate: rainviewerTileUrl(host, f.path, kind),
  }));
}

async function buildProductFrames(
  meta: SatelliteProductMeta,
  gibsLatestMs: number | null,
  radarTimesUnix: number[] = [],
): Promise<WeatherFrame[]> {
  if (meta.provider === "realearth" && meta.realearthProduct) {
    const times = await fetchRealEarthTimes(meta.realearthProduct, FRAME_COUNT);
    if (radarTimesUnix.length >= 3 && times.length > 0) {
      const latest = times[times.length - 1]!;
      const aligned = alignTimesToRadar(
        radarTimesUnix,
        latest,
        GIBS_STEP_SEC,
        FRAME_COUNT,
      );
      if (aligned.length >= 3) {
        // Prefer RealEarth's native stamps that fall on the radar spine.
        const allowed = new Set(aligned);
        const filtered = times.filter((t) =>
          [...allowed].some((a) => Math.abs(a - t) <= GIBS_STEP_SEC / 2),
        );
        if (filtered.length >= 3) return buildFramesFromTimes(meta.id, filtered);
        return buildFramesFromTimes(meta.id, aligned);
      }
    }
    return buildFramesFromTimes(meta.id, times);
  }
  if (gibsLatestMs == null) return [];
  const latestUnix = Math.floor(gibsLatestMs / 1000);
  if (radarTimesUnix.length >= 3) {
    const aligned = alignTimesToRadar(
      radarTimesUnix,
      latestUnix,
      GIBS_STEP_SEC,
      FRAME_COUNT,
    );
    if (aligned.length >= 3) {
      return buildFramesFromTimes(meta.id, aligned);
    }
  }
  return buildFramesAtLatest(meta.id, gibsLatestMs);
}

/**
 * Build every catalog product. GIBS products share one probed timeline;
 * RealEarth products use SSEC's native 10-minute time list.
 * When RainViewer radar is available, satellite times are snapped onto the
 * same 10-minute spine so rain radar and IR cover the same period.
 */
async function buildAllSatelliteProducts(
  radarTimesUnix: number[] = [],
): Promise<{
  products: WeatherMapsPayload["satellite"]["products"];
  source: WeatherMapsPayload["satellite"]["source"];
}> {
  const products = emptyProductFrames();

  const gibsLatestMs =
    (await findLatestGibsTime("infrared")) ??
    (await findLatestGibsTime("airmass")) ??
    (await findLatestGibsTime("visible")) ??
    fallbackGibsLatestMs();

  const built = await Promise.all(
    SATELLITE_PRODUCTS.map(async (meta) => {
      const frames = await buildProductFrames(
        meta,
        gibsLatestMs,
        radarTimesUnix,
      );
      return [meta.id, frames] as const;
    }),
  );

  for (const [id, frames] of built) {
    products[id] = { frames };
  }

  // Warm the default infrared loop into the server frame cache
  if (products.infrared.frames.length) {
    warmFramesInBackground(
      "infrared",
      products.infrared.frames.map((f) => f.time),
      3,
    );
  }

  const hasGibs = SATELLITE_PRODUCTS.some(
    (p) => p.provider === "gibs" && products[p.id].frames.length > 0,
  );
  const hasRealEarth = SATELLITE_PRODUCTS.some(
    (p) => p.provider === "realearth" && products[p.id].frames.length > 0,
  );
  const source: WeatherMapsPayload["satellite"]["source"] =
    hasGibs && hasRealEarth
      ? "mixed"
      : hasRealEarth
        ? "realearth-himawari"
        : "gibs-himawari";

  return { products, source };
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

    const rvPromise = fetch(RAINVIEWER_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SkyWatchAustralia/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
      .then(async (rvRes) => {
        if (!rvRes.ok) throw new Error(`RainViewer HTTP ${rvRes.status}`);
        return (await rvRes.json()) as RainViewerMaps;
      })
      .catch(() => null);

    // RainViewer first so satellite frames can share its 2h / 10-minute spine.
    const rv = await rvPromise;
    const host = rv?.host ?? "https://tilecache.rainviewer.com";
    const radarPast = normalizeRainviewerFrames(host, rv?.radar?.past, "radar");
    const radarTimesUnix = radarPast.map((f) => f.time);

    const satellite = wantAll
      ? await buildAllSatelliteProducts(radarTimesUnix)
      : await (async () => {
          const products = emptyProductFrames();
          const meta = getSatelliteProduct(product);
          const gibsLatestMs =
            meta.provider === "gibs"
              ? ((await findLatestGibsTime(
                  meta.id === "visible" ? "infrared" : meta.id,
                )) ?? fallbackGibsLatestMs())
              : null;
          products[product] = {
            frames: await buildProductFrames(
              meta,
              gibsLatestMs,
              radarTimesUnix,
            ),
          };
          return {
            products,
            source:
              meta.provider === "realearth"
                ? ("realearth-himawari" as const)
                : ("gibs-himawari" as const),
          };
        })();

    // Safety net: if a product somehow still extends past radar, clip it.
    if (radarPast.length >= 3) {
      for (const id of Object.keys(satellite.products) as SatelliteProductId[]) {
        satellite.products[id] = {
          frames: trimFramesToRadarWindow(
            satellite.products[id].frames,
            radarPast,
          ),
        };
      }
    }

    const generated = rv?.generated ?? Math.floor(Date.now() / 1000);
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
        past: radarPast,
        source: "rainviewer",
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        "X-Satellite-Product": wantAll ? "all" : product,
        "X-Satellite-Layer":
          activeMeta.gibsLayer ?? activeMeta.realearthProduct ?? activeProduct,
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
