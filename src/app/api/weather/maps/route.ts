import { NextResponse } from "next/server";
import {
  GIBS_AU_BOUNDS,
  gibsHimawariWmsUrl,
  rainviewerTileUrl,
  toIsoZ,
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

async function probeGibsWms(isoTime: string): Promise<boolean> {
  try {
    const res = await fetch(gibsHimawariWmsUrl(isoTime), {
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
    // Sample a few bytes past the PNG header — reject near-solid black payloads
    let nonBlack = 0;
    for (let i = 100; i < Math.min(buf.length, 4000); i += 17) {
      if (buf[i]! > 16) nonBlack += 1;
    }
    return nonBlack >= 8;
  } catch {
    return false;
  }
}

async function buildGibsInfraredFrames(): Promise<WeatherFrame[]> {
  let latestMs = Math.floor(Date.now() / GIBS_STEP_MS) * GIBS_STEP_MS;
  let found = false;

  for (let i = 0; i < GIBS_PROBE_MAX; i++) {
    const candidate = latestMs - i * GIBS_STEP_MS;
    if (await probeGibsWms(toIsoZ(candidate))) {
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
      imageUrl: gibsHimawariWmsUrl(iso),
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

export async function GET() {
  try {
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

    let infrared = normalizeRainviewerFrames(
      host,
      rv.satellite?.infrared,
      "satellite",
    );
    let satelliteSource: WeatherMapsPayload["satellite"]["source"] =
      "rainviewer";

    if (infrared.length === 0) {
      infrared = await buildGibsInfraredFrames();
      satelliteSource = "gibs-himawari";
    }

    const payload: WeatherMapsPayload = {
      generated,
      host,
      satellite: {
        infrared,
        source: satelliteSource,
      },
      radar: {
        past: normalizeRainviewerFrames(host, rv.radar?.past, "radar"),
        source: "rainviewer",
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
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
