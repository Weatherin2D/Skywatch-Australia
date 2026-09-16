import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SATELLITE_PRODUCT,
  GIBS_AU_BOUNDS,
  SATELLITE_PRODUCTS,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
  isSatelliteProductId,
  rainviewerTileUrl,
  satelliteFrameProxyUrl,
  toIsoZ,
  type SatelliteProductId,
  type WeatherFrame,
  type WeatherMapsPayload,
} from "@/lib/weather/maps";
import { warmFramesInBackground } from "@/lib/weather/fetch-frame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAINVIEWER_URL = "https://api.rainviewer.com/public/weather-maps.json";
const GIBS_STEP_MS = 10 * 60 * 1000;
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
  return {
    visible: { frames: [] },
    infrared: { frames: [] },
    airmass: { frames: [] },
  };
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
        signal: AbortSignal.timeout(4000),
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

function buildFramesAtLatest(
  product: SatelliteProductId,
  latestMs: number,
  count = FRAME_COUNT,
): WeatherFrame[] {
  const frames: WeatherFrame[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const ms = latestMs - i * GIBS_STEP_MS;
    const time = Math.floor(ms / 1000);
    frames.push({
      time,
      imageUrl: satelliteFrameProxyUrl(product, time),
      imageBounds: GIBS_AU_BOUNDS,
    });
  }
  return frames;
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

/**
 * One shared Himawari timeline for all products, then parallel URL assembly.
 * Probe infrared first (most reliable), fall back to other layers.
 */
async function buildAllSatelliteProducts(): Promise<{
  products: WeatherMapsPayload["satellite"]["products"];
  source: WeatherMapsPayload["satellite"]["source"];
}> {
  const products = emptyProductFrames();

  const latestMs =
    (await findLatestGibsTime("infrared")) ??
    (await findLatestGibsTime("airmass")) ??
    (await findLatestGibsTime("visible"));

  if (latestMs == null) {
    return { products, source: "gibs-himawari" };
  }

  for (const meta of SATELLITE_PRODUCTS) {
    products[meta.id] = {
      frames: buildFramesAtLatest(meta.id, latestMs),
    };
  }

  // Warm infrared (default) into the server frame cache immediately
  warmFramesInBackground(
    "infrared",
    products.infrared.frames.map((f) => f.time),
    3,
  );

  return { products, source: "gibs-himawari" };
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

    const satellitePromise = wantAll
      ? buildAllSatelliteProducts()
      : (async () => {
          const products = emptyProductFrames();
          const latestMs = await findLatestGibsTime(product);
          if (latestMs != null) {
            products[product] = {
              frames: buildFramesAtLatest(product, latestMs),
            };
          }
          return { products, source: "gibs-himawari" as const };
        })();

    const [rv, satellite] = await Promise.all([rvPromise, satellitePromise]);

    const host = rv?.host ?? "https://tilecache.rainviewer.com";
    const generated = rv?.generated ?? Math.floor(Date.now() / 1000);
    const activeProduct = wantAll ? DEFAULT_SATELLITE_PRODUCT : product;
    const frames = satellite.products[activeProduct].frames;

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
        past: normalizeRainviewerFrames(host, rv?.radar?.past, "radar"),
        source: "rainviewer",
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        "X-Satellite-Product": wantAll ? "all" : product,
        "X-Satellite-Layer": getSatelliteProduct(activeProduct).gibsLayer,
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
