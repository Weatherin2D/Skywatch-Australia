import { NextRequest, NextResponse } from "next/server";
import {
  fetchModelSounding,
  fetchModelSoundingBox,
} from "@/lib/weather/model-sounding";
import {
  getSoundingStation,
  nearestSoundingStation,
  SOUNDING_STATIONS,
} from "@/lib/weather/sounding-stations";
import type {
  SoundingBoxSpacingDeg,
  SoundingModelId,
  SoundingMode,
} from "@/lib/weather/sounding-types";
import {
  fetchObservedSounding,
  fetchObservedSoundingArchive,
} from "@/lib/weather/uwyo-sounding";
import {
  attachSkywatchAiEngine,
  fetchSkywatchAiPredictPoint,
  parseEngineMode,
  skywatchAiBaseUrl,
  soundingPayloadFromAiPredict,
} from "@/lib/weather/skywatch-ai-client";
import type { SoundingBoxPayload } from "@/lib/weather/sounding-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

const MODELS = new Set<SoundingModelId>(["pulse", "ukmo", "ifs", "access"]);
const BOX_SPACING = new Set<SoundingBoxSpacingDeg>([0.25, 0.5, 1]);

/**
 * GET /api/weather/sounding
 *   ?mode=observed|model|box
 *   &station=94610          (observed WMO)
 *   &lat=&lon=&place=       (model/box point; observed falls back to nearest)
 *   &model=pulse|ukmo|ifs|access
 *   &spacing=0.25|0.5|1     (box mode, degrees)
 *   &time=ISO
 *   &engine=auto|skywatch|legacy|predict  (predict = V1 neural demo)
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
          engines: [
            { id: "auto", label: "Auto (engine)" },
            { id: "skywatch", label: "CloudCountry AI engine" },
            { id: "predict", label: "CloudCountry AI V1" },
            { id: "legacy", label: "Legacy" },
          ],
          skywatchAiConfigured: Boolean(skywatchAiBaseUrl()),
        },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        },
      );
    }

    const mode = (url.searchParams.get("mode") || "observed").toLowerCase() as SoundingMode;
    const engineMode = parseEngineMode(url.searchParams.get("engine"));
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

    if (mode === "model" || mode === "box") {
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
      if (mode === "box") {
        const spacingRaw = Number(url.searchParams.get("spacing") || "0.5");
        const spacing = (
          BOX_SPACING.has(spacingRaw as SoundingBoxSpacingDeg)
            ? spacingRaw
            : 0.5
        ) as SoundingBoxSpacingDeg;
        const payload = await fetchModelSoundingBox({
          latitude: lat,
          longitude: lon,
          model,
          placeLabel: place,
          time,
          spacingDeg: spacing,
        });
        const enriched = await attachEngineToBox(payload, engineMode);
        return NextResponse.json(enriched, {
          headers: {
            "Cache-Control":
              enriched.status === "ok"
                ? "public, max-age=120, stale-while-revalidate=600"
                : "no-store",
          },
        });
      }
      // AI V1: prefer sidecar point predict (one lean teacher fetch) so Skew-T
      // still works when Open-Meteo's multi-level forecast API is 429'd.
      if (engineMode === "predict" && skywatchAiBaseUrl()) {
        const teacherModel =
          model === "ifs" ? "ifs" : model === "access" ? "access" : "pulse";
        const pred = await fetchSkywatchAiPredictPoint({
          lat,
          lon,
          time,
          hemisphere: "S",
          teacherModel,
        });
        if (pred?.levels?.length) {
          const aiPayload = soundingPayloadFromAiPredict(pred, {
            lat,
            lon,
            model,
            placeLabel: place,
          });
          return NextResponse.json(aiPayload, {
            headers: {
              "Cache-Control":
                "public, max-age=120, stale-while-revalidate=600",
            },
          });
        }
      }

      const payload = await fetchModelSounding({
        latitude: lat,
        longitude: lon,
        model,
        placeLabel: place,
        time,
      });
      const enriched = await attachSkywatchAiEngine(payload, engineMode);

      // Last resort: OM sounding empty + AI V1 still wanted.
      if (
        enriched.status !== "ok" &&
        engineMode === "predict" &&
        skywatchAiBaseUrl()
      ) {
        const teacherModel =
          model === "ifs" ? "ifs" : model === "access" ? "access" : "pulse";
        const pred = await fetchSkywatchAiPredictPoint({
          lat,
          lon,
          time,
          hemisphere: "S",
          teacherModel,
        });
        if (pred?.levels?.length) {
          return NextResponse.json(
            soundingPayloadFromAiPredict(pred, {
              lat,
              lon,
              model,
              placeLabel: place,
            }),
            {
              headers: {
                "Cache-Control":
                  "public, max-age=120, stale-while-revalidate=600",
              },
            },
          );
        }
      }

      return NextResponse.json(enriched, {
        headers: {
          "Cache-Control":
            enriched.status === "ok"
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
    const enriched = await attachSkywatchAiEngine(payload, engineMode);
    return NextResponse.json(enriched, {
      headers: {
        "Cache-Control":
          enriched.status === "ok"
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

async function attachEngineToBox(
  payload: SoundingBoxPayload,
  engineMode: ReturnType<typeof parseEngineMode>,
): Promise<SoundingBoxPayload> {
  if (payload.status !== "ok" || !payload.cells.length) return payload;
  // Centre cell first (row=1,col=1), then the rest — keeps latency bounded.
  const centre =
    payload.cells.find((c) => c.row === 1 && c.col === 1) ?? payload.cells[0]!;
  const centreSounding = await attachSkywatchAiEngine(
    centre.sounding,
    engineMode,
  );
  const cells = await Promise.all(
    payload.cells.map(async (cell) => {
      if (cell === centre || (cell.row === centre.row && cell.col === centre.col)) {
        return { ...cell, sounding: centreSounding };
      }
      // Box grid: only centre gets engine/predict (keeps latency bounded).
      if (
        engineMode === "legacy" ||
        engineMode === "auto" ||
        engineMode === "predict"
      ) {
        return {
          ...cell,
          sounding: { ...cell.sounding, engine: "legacy" as const },
        };
      }
      return {
        ...cell,
        sounding: await attachSkywatchAiEngine(cell.sounding, engineMode),
      };
    }),
  );
  return { ...payload, cells };
}
