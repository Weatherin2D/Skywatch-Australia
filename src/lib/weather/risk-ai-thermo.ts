/**
 * Build a compact AI / thermo overlay for Risk inspect from a sounding payload.
 */

import { engineModeLabel, type EngineUiMode } from "@/lib/weather/engine-mode";
import type { SoundingPayload } from "@/lib/weather/sounding-types";

export type RiskAiThermo = {
  engine: "skywatch-ai" | "skywatch-ai-v1" | "legacy";
  label: string;
  message?: string;
  conditions: Array<{ label: string; value: string; hint?: string }>;
  soundingUrl?: string;
};

function fmt(n: number | null | undefined, digits = 0, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
}

export function riskAiThermoFromSounding(
  sounding: SoundingPayload,
  engineMode: EngineUiMode,
): RiskAiThermo | null {
  if (sounding.status !== "ok" || !sounding.levels.length) return null;

  const engine = sounding.engine ?? "legacy";
  const sfc = sounding.params.parcels.find((p) => p.id === "SFC");
  const mu = sounding.params.parcels.find((p) => p.id === "MU");
  const conditions = [
    { label: "SBCAPE", value: fmt(sfc?.cape, 0, " J/kg") },
    { label: "MUCAPE", value: fmt(mu?.cape, 0, " J/kg") },
    { label: "0–6 km shear", value: fmt(sounding.params.shear0to6Kts, 0, " kt") },
    { label: "0–3 km SRH", value: fmt(sounding.params.srh0to3, 0, " m²/s²") },
    { label: "PWAT", value: fmt(sounding.params.pwMm, 1, " mm") },
    { label: "Lapse 0–3", value: fmt(sounding.params.lapse0to3, 1, " °C/km") },
  ];

  const qs = new URLSearchParams({
    mode: "model",
    engine: engineMode,
    lat: sounding.latitude.toFixed(3),
    lon: sounding.longitude.toFixed(3),
  });
  if (sounding.model) qs.set("model", sounding.model);

  const label =
    engine === "skywatch-ai-v1"
      ? "StormFront Australia experimental model"
      : engine === "skywatch-ai"
        ? "StormFront Australia weather model"
        : engineModeLabel(engineMode);

  return {
    engine,
    label,
    message:
      sounding.engineMessage ??
      (engine === "skywatch-ai-v1"
        ? "Experimental forecast model; results may be incomplete."
        : undefined),
    conditions,
    soundingUrl: `/soundings?${qs}`,
  };
}

/** Map risk source → sounding model id for the overlay fetch. */
export function riskSourceToSoundingModel(
  source: string,
): "pulse" | "ukmo" | "ifs" | "access" {
  if (source === "ukmo") return "ukmo";
  if (source === "ifs") return "ifs";
  if (source === "access") return "access";
  return "pulse";
}
