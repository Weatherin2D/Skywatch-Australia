/** Shared sounding / thermo engine UI mode (client + URL). */

export type EngineUiMode = "auto" | "predict" | "legacy";

export const ENGINE_UI_OPTIONS: {
  id: EngineUiMode;
  label: string;
  title?: string;
}[] = [
  { id: "auto", label: "Engine" },
  {
    id: "predict",
    label: "AI V1",
    title:
      "CloudCountry AI V1 — ETL-trained neural residual on Open-Meteo teacher (local sidecar)",
  },
  { id: "legacy", label: "Legacy" },
];

export function parseEngineUiMode(raw: string | null | undefined): EngineUiMode {
  const v = (raw || "auto").toLowerCase();
  if (v === "predict" || v === "ai-v1" || v === "v1" || v === "ai") {
    return "predict";
  }
  if (v === "legacy" || v === "ts") return "legacy";
  return "auto";
}

export function engineModeLabel(mode: EngineUiMode): string {
  if (mode === "predict") return "CloudCountry AI V1";
  if (mode === "legacy") return "Legacy thermo";
  return "CloudCountry AI engine";
}
