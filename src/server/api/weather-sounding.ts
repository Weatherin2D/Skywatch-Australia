import { NextRequest, NextResponse } from "next/server";
import { fetchModelSounding } from "@/lib/weather/model-sounding";
import {
  getSoundingStation,
  nearestSoundingStation,
  SOUNDING_STATIONS,
} from "@/lib/weather/sounding-stations";
import type { SoundingModelId, SoundingMode } from "@/lib/weather/sounding-types";
import {
  fetchObservedSounding,
  fetchObservedSoundingArchive,
} from "@/lib/weather/uwyo-sounding";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

const MODELS = new Set<SoundingModelId>(["pulse", "ukmo", "ifs", "access"]);

/**
 * GET /api/weather/sounding
 *   ?mode=observed|model
 *   &station=94610          (observed WMO)
 *   &lat=&lon=&place=       (model point; observed falls back to nearest)
 *   &model=pulse|ukmo|ifs|access
 *   &time=ISO
 *   &meta=1                 → station list only
 *   &archive=1              → observed UWYO inventory slots for station/year(s)
 *   &year=2026              → single year for archive (default: current+previous)
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("meta") === "1") {
      return NextResponse.json(
        {
          stations: SOUNDING_STATIONS,
          models: [
            { id: "pulse", label: "Pulse" },
            { id: "ukmo", label: "UKMO" },
            { id: "ifs", label: "IFS" },
            { id: "access", label: "ACCESS-G" },
          ],
        },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        },
      );
    }

    const mode = (url.searchParams.get("mode") || "observed").toLowerCase() as SoundingMode;
    const time = url.searchParams.get("time");
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const place = url.searchParams.get("place") || undefined;

    if (url.searchParams.get("archive") === "1") {
      let wmo = url.searchParams.get("station")?.trim() || "";
      if (!wmo) {
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          wmo = nearestSoundingStation(lat, lon).wmo;
        } else {
          wmo = "94610";
        }
      }
      if (!getSoundingStation(wmo) && !/^\d{5}$/.test(wmo)) {
        return NextResponse.json({ error: "Unknown station" }, { status: 400 });
      }
      const yearParam = url.searchParams.get("year");
      const years = yearParam
        ? yearParam
            .split(",")
            .map((y) => Number(y))
            .filter((y) => Number.isFinite(y) && y >= 1970 && y <= 2100)
        : undefined;
      const catalog = await fetchObservedSoundingArchive({ wmo, years });
      return NextResponse.json(catalog, {
        headers: {
          "Cache-Control": "public, max-age=600, stale-while-revalidate=3600",
        },
      });
    }

    if (mode === "model") {
      const modelParam = (url.searchParams.get("model") || "pulse").toLowerCase();
      const model = (MODELS.has(modelParam as SoundingModelId)
        ? modelParam
        : "pulse") as SoundingModelId;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return NextResponse.json(
          { error: "lat and lon required for model soundings" },
          { status: 400 },
        );
      }
      const payload = await fetchModelSounding({
        latitude: lat,
        longitude: lon,
        model,
        placeLabel: place,
        time,
      });
      return NextResponse.json(payload, {
        headers: {
          "Cache-Control":
            payload.status === "ok"
              ? "public, max-age=120, stale-while-revalidate=600"
              : "no-store",
        },
      });
    }

    let wmo = url.searchParams.get("station")?.trim() || "";
    if (!wmo) {
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        wmo = nearestSoundingStation(lat, lon).wmo;
      } else {
        wmo = "94767"; // Sydney default
      }
    }
    if (!getSoundingStation(wmo) && !/^\d{5}$/.test(wmo)) {
      return NextResponse.json({ error: "Unknown station" }, { status: 400 });
    }

    const payload = await fetchObservedSounding({ wmo, time });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control":
          payload.status === "ok"
            ? "public, max-age=300, stale-while-revalidate=1800"
            : "no-store",
      },
    });
  } catch (err) {
    console.error("[weather/sounding]", err);
    return NextResponse.json(
      { error: "Sounding unavailable" },
      { status: 502 },
    );
  }
}
