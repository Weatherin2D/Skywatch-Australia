/** Shared sounding / thermo engine UI mode (client + URL). */

export type EngineUiMode = "auto" | "predict" | "legacy";

export const ENGINE_UI_OPTIONS: {
  id: EngineUiMode;
  label: string;
  title?: string;
}[] = [
  { id: "auto", label: "Standard model" },
  {
    id: "predict",
    label: "Experimental model",
    title: "Experimental forecast model. Results may be incomplete.",
  },
  { id: "legacy", label: "Original model" },
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
  if (mode === "predict") return "Experimental forecast model";
  if (mode === "legacy") return "Original weather model";
  return "StormFront Australia weather model";
}
