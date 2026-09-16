import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SATELLITE_PRODUCT,
  GIBS_AU_BOUNDS,
  gibsHimawariWmsUrl,
  getSatelliteProduct,
  isSatelliteProductId,
  rainviewerTileUrl,
  toIsoZ,
  type SatelliteProductId,
  type WeatherFrame,
  type WeatherMapsPayload,
} from "@/lib/weather/maps";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAINVIEWER_URL = "https://api.rainviewer.com/public/weather-maps.json";
const GIBS_STEP_MS = 10 * 60 * 1000;
const GIBS_FRAME_COUNT = 18;
const GIBS_PROBE_MAX = 18;

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

async function probeGibsWms(
  isoTime: string,
  product: SatelliteProductId,
): Promise<boolean> {
  try {
    const res = await fetch(gibsHimawariWmsUrl(isoTime, product), {
      method: "GET",
      headers: { "User-Agent": "SkyWatchAustralia/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("image")) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    // Empty / not-yet-available Himawari frames often come back as tiny near-black PNGs
    if (buf.length < 40_000) return false;
    let nonBlack = 0;
    for (let i = 100; i < Math.min(buf.length, 4000); i += 17) {
      if (buf[i]! > 16) nonBlack += 1;
    }
    return nonBlack >= 8;
  } catch {
    return false;
  }
}

async function buildGibsFrames(
  product: SatelliteProductId,
): Promise<WeatherFrame[]> {
  let latestMs = Math.floor(Date.now() / GIBS_STEP_MS) * GIBS_STEP_MS;
  let found = false;

  for (let i = 0; i < GIBS_PROBE_MAX; i++) {
    const candidate = latestMs - i * GIBS_STEP_MS;
    if (await probeGibsWms(toIsoZ(candidate), product)) {
      latestMs = candidate;
      found = true;
      break;
    }
  }

  if (!found) return [];

  const frames: WeatherFrame[] = [];
  for (let i = GIBS_FRAME_COUNT - 1; i >= 0; i--) {
    const ms = latestMs - i * GIBS_STEP_MS;
    const iso = toIsoZ(ms);
    frames.push({
      time: Math.floor(ms / 1000),
      imageUrl: gibsHimawariWmsUrl(iso, product),
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

export async function GET(request: NextRequest) {
  try {
    const rawProduct = request.nextUrl.searchParams.get("product") ?? "";
    const product: SatelliteProductId = isSatelliteProductId(rawProduct)
      ? rawProduct
      : DEFAULT_SATELLITE_PRODUCT;

    const rvRes = await fetch(RAINVIEWER_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SkyWatchAustralia/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    if (!rvRes.ok) {
      throw new Error(`RainViewer HTTP ${rvRes.status}`);
    }

    const rv = (await rvRes.json()) as RainViewerMaps;
    const host = rv.host ?? "https://tilecache.rainviewer.com";
    const generated = rv.generated ?? Math.floor(Date.now() / 1000);

    const products = emptyProductFrames();
    let satelliteSource: WeatherMapsPayload["satellite"]["source"] =
      "gibs-himawari";

    // RainViewer IR only maps onto the infrared product when available
    if (product === "infrared") {
      const rvInfrared = normalizeRainviewerFrames(
        host,
        rv.satellite?.infrared,
        "satellite",
      );
      if (rvInfrared.length > 0) {
        products.infrared = { frames: rvInfrared };
        satelliteSource = "rainviewer";
      } else {
        products.infrared = { frames: await buildGibsFrames("infrared") };
        satelliteSource = "gibs-himawari";
      }
    } else {
      products[product] = { frames: await buildGibsFrames(product) };
      satelliteSource = "gibs-himawari";
    }

    const frames = products[product].frames;
    const payload: WeatherMapsPayload = {
      generated,
      host,
      satellite: {
        product,
        source: satelliteSource,
        frames,
        products,
      },
      radar: {
        past: normalizeRainviewerFrames(host, rv.radar?.past, "radar"),
        source: "rainviewer",
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        "X-Satellite-Product": product,
        "X-Satellite-Layer": getSatelliteProduct(product).gibsLayer,
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
