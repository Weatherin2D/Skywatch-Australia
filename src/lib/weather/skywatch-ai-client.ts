/**
 * Thin client for the SkyWatch AI diagnostics sidecar.
 * Unset SKYWATCH_AI_URL → null (Vercel Hobby / no Docker).
 */

import type {
  SoundingLevel,
  SoundingParams,
  SoundingPayload,
} from "@/lib/weather/sounding-types";

export type SoundingEngineId = "skywatch-ai" | "skywatch-ai-v1" | "legacy";
export type SoundingEngineMode = "auto" | "skywatch" | "legacy" | "predict";

export type SkywatchAiDiagnostics = Record<string, number>;

export type SkywatchAiResult = {
  engine: "skywatch-ai";
  hemisphere: string;
  diagnostics: SkywatchAiDiagnostics;
  meta: Record<string, unknown>;
};

export type SkywatchAiPredictResult = {
  engine: string;
  dataset_version?: string;
  disclaimer?: string;
  teacher_mode?: string;
  teacher?: Record<string, unknown>;
  levels: Array<{
    p: number;
    t: number;
    td: number;
    z: number;
    windDir: number;
    windSpd: number;
    u?: number;
    v?: number;
  }>;
  diagnostics: SkywatchAiDiagnostics;
  hemisphere: string;
};

const MS_TO_KT = 1 / 0.514444;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function roundOrNull(n: unknown, digits = 0): number | null {
  if (!finite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Meteorological direction ° and speed kt from u/v (m/s). */
function uvToDirKts(u: number, v: number): { dir: number; kts: number } {
  const spd = Math.hypot(u, v);
  const dir = ((270 - (Math.atan2(v, u) * 180) / Math.PI) % 360 + 360) % 360;
  return { dir: Math.round(dir), kts: Math.round(spd * MS_TO_KT * 10) / 10 };
}

export function skywatchAiBaseUrl(): string | null {
  const raw = process.env.SKYWATCH_AI_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function parseEngineMode(raw: string | null): SoundingEngineMode {
  const v = (raw || "auto").toLowerCase();
  if (v === "skywatch" || v === "skywatch-ai" || v === "ai") return "skywatch";
  if (v === "predict" || v === "ai-v1" || v === "v1") return "predict";
  if (v === "legacy" || v === "ts") return "legacy";
  return "auto";
}

/**
 * Call sidecar POST /v1/diagnostics. Returns null on miss/timeout/error.
 */
export async function fetchSkywatchAiDiagnostics(
  levels: SoundingLevel[],
  options?: {
    hemisphere?: "N" | "S";
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<SkywatchAiResult | null> {
  const base = skywatchAiBaseUrl();
  if (!base || levels.length < 3) return null;

  const timeoutMs = options?.timeoutMs ?? 4_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  options?.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(`${base}/v1/diagnostics`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        levels: levels.map((L) => ({
          p: L.p,
          t: L.t,
          td: L.td,
          z: L.z,
          windDir: L.windDir,
          windSpd: L.windSpd,
        })),
        hemisphere: options?.hemisphere ?? "S",
        tempUnit: "C",
        windUnit: "ms",
        virtual: true,
      }),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as SkywatchAiResult;
    if (!json?.diagnostics || typeof json.diagnostics !== "object") return null;
    return {
      engine: "skywatch-ai",
      hemisphere: json.hemisphere ?? "S",
      diagnostics: json.diagnostics,
      meta: json.meta ?? {},
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Overlay SkyWatch AI parcel/shear/moisture numbers onto legacy params.
 * Keeps legacy composites (SCP/STP/SHIP/hazard) and parcelTraces untouched.
 */
export function mergeAiIntoParams(
  legacy: SoundingParams,
  d: SkywatchAiDiagnostics,
): SoundingParams {
  const parcel = (
    id: "SFC" | "ML" | "MU",
    label: string,
    tag: "SB" | "ML" | "MU",
  ) => {
    const prev = legacy.parcels.find((p) => p.id === id);
    return {
      id,
      label,
      cape: roundOrNull(d[`${tag}CAPE`]),
      cin: roundOrNull(d[`${tag}CIN`]),
      lclHpa: roundOrNull(d[`${tag}_LCL_hpa`]),
      lclM: roundOrNull(d[`${tag}_LCL`]),
      li: prev?.li ?? null,
      lfcHpa: roundOrNull(d[`${tag}_LFC_hpa`]),
      elHpa: roundOrNull(d[`${tag}_EL_hpa`]),
    };
  };

  const mean =
    finite(d.storm_motion_u) && finite(d.storm_motion_v)
      ? uvToDirKts(d.storm_motion_u, d.storm_motion_v)
      : null;
  // Southern-hemisphere Bunkers left-mover is the cyclonic member; expose as LM.
  const bunkers =
    finite(d.storm_motion_u) && finite(d.storm_motion_v)
      ? uvToDirKts(d.storm_motion_u, d.storm_motion_v)
      : null;

  return {
    ...legacy,
    parcels: [
      parcel("SFC", "Surface", "SB"),
      parcel("ML", "Mixed-layer", "ML"),
      parcel("MU", "Most-unstable", "MU"),
    ],
    pwMm: roundOrNull(d.PWAT, 1) ?? legacy.pwMm,
    lapse0to3: roundOrNull(d.lapse_0_3km, 1) ?? legacy.lapse0to3,
    lapse3to6: roundOrNull(d.lapse_3_6km, 1) ?? legacy.lapse3to6,
    lapse700to500: roundOrNull(d.lapse_700_500, 1) ?? legacy.lapse700to500,
    shear0to1Kts:
      roundOrNull(
        finite(d.shear_0_1km) ? d.shear_0_1km * MS_TO_KT : null,
        1,
      ) ?? legacy.shear0to1Kts,
    shear0to3Kts:
      roundOrNull(
        finite(d.shear_0_3km) ? d.shear_0_3km * MS_TO_KT : null,
        1,
      ) ?? legacy.shear0to3Kts,
    shear0to6Kts:
      roundOrNull(
        finite(d.shear_0_6km) ? d.shear_0_6km * MS_TO_KT : null,
        1,
      ) ?? legacy.shear0to6Kts,
    srh0to1: roundOrNull(d.srh_0_1km) ?? legacy.srh0to1,
    srh0to3: roundOrNull(d.srh_0_3km) ?? legacy.srh0to3,
    meanWind0to6Dir:
      finite(d.mean_wind_0_6km) && mean
        ? mean.dir
        : legacy.meanWind0to6Dir,
    meanWind0to6Kts: finite(d.mean_wind_0_6km)
      ? roundOrNull(d.mean_wind_0_6km * MS_TO_KT, 1)
      : legacy.meanWind0to6Kts,
    bunkersLeftDir: bunkers?.dir ?? legacy.bunkersLeftDir,
    bunkersLeftKts: bunkers?.kts ?? legacy.bunkersLeftKts,
  };
}

/**
 * V1 neural predict — returns corrected levels + engine diagnostics.
 * Synthetic-trained demo until real ETL training is live.
 */
export async function fetchSkywatchAiPredict(
  levels: SoundingLevel[],
  options?: {
    lat?: number;
    lon?: number;
    time?: string | null;
    hemisphere?: "N" | "S";
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<SkywatchAiPredictResult | null> {
  const base = skywatchAiBaseUrl();
  if (!base || levels.length < 3) return null;

  const timeoutMs = options?.timeoutMs ?? 45_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  options?.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(`${base}/v1/predict`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        levels: levels.map((L) => ({
          p: L.p,
          t: L.t,
          td: L.td,
          z: L.z,
          windDir: L.windDir,
          windSpd: L.windSpd,
        })),
        lat: options?.lat ?? -31.95,
        lon: options?.lon ?? 115.86,
        hemisphere: options?.hemisphere ?? "S",
        tempUnit: "C",
        windUnit: "ms",
        time: options?.time ?? undefined,
        teacherModel: "pulse",
      }),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as SkywatchAiPredictResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

function levelsFromPredict(
  pred: SkywatchAiPredictResult,
): SoundingLevel[] {
  return pred.levels.map((L) => {
    const rh =
      L.t != null && L.td != null
        ? Math.max(
            0,
            Math.min(
              100,
              100 *
                Math.exp(
                  (17.625 * L.td) / (243.04 + L.td) -
                    (17.625 * L.t) / (243.04 + L.t),
                ),
            ),
          )
        : null;
    return {
      p: L.p,
      z: L.z,
      t: L.t,
      td: L.td,
      rh,
      windDir: L.windDir,
      windSpd: L.windSpd,
    };
  });
}

export async function attachSkywatchAiEngine(
  payload: SoundingPayload,
  mode: SoundingEngineMode,
  signal?: AbortSignal,
): Promise<SoundingPayload> {
  if (payload.status !== "ok" || payload.levels.length < 3) {
    return { ...payload, engine: "legacy" };
  }
  if (mode === "legacy") {
    return { ...payload, engine: "legacy" };
  }
  if (mode === "auto" && !skywatchAiBaseUrl()) {
    return { ...payload, engine: "legacy" };
  }

  // Neural V1 (Open-Meteo teacher + obs tokens)
  if (mode === "predict") {
    const pred = await fetchSkywatchAiPredict(payload.levels, {
      lat: payload.latitude,
      lon: payload.longitude,
      time: payload.validTime,
      hemisphere: "S",
      signal,
    });
    if (!pred?.levels?.length) {
      return {
        ...payload,
        engine: "legacy",
        engineMessage:
          "SkyWatch AI V1 predict unavailable — using legacy thermo",
      };
    }
    const levels = levelsFromPredict(pred);
    const teacherNote =
      pred.teacher_mode === "open-meteo"
        ? "Open-Meteo teacher"
        : "self-prior fallback";
    return {
      ...payload,
      levels,
      params: mergeAiIntoParams(payload.params, pred.diagnostics),
      engine: "skywatch-ai-v1",
      engineHemisphere: pred.hemisphere,
      engineMessage: pred.disclaimer,
      aiDiagnostics: pred.diagnostics,
      attribution: `${payload.attribution} · SkyWatch AI V1 (${teacherNote})`,
    };
  }

  const ai = await fetchSkywatchAiDiagnostics(payload.levels, {
    hemisphere: "S",
    signal,
  });
  if (!ai) {
    if (mode === "skywatch") {
      return {
        ...payload,
        engine: "legacy",
        engineMessage: "SkyWatch AI sidecar unavailable — using legacy thermo",
      };
    }
    return { ...payload, engine: "legacy" };
  }

  return {
    ...payload,
    params: mergeAiIntoParams(payload.params, ai.diagnostics),
    engine: "skywatch-ai",
    engineHemisphere: ai.hemisphere,
    aiDiagnostics: ai.diagnostics,
  };
}
