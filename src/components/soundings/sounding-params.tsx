"use client";

import type { SoundingParams } from "@/lib/weather/sounding-types";
import { cn } from "@/lib/utils";

function fmt(n: number | null | undefined, digits = 0, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${digits === 0 ? Math.round(n) : n.toFixed(digits)}${suffix}`;
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-1 text-[12px] leading-tight">
      <span className="text-white/50">{label}</span>
      <span
        className={cn(
          "font-mono font-semibold tabular-nums",
          accent ? "text-[var(--cyan)]" : "text-white/90",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1.5 font-[family-name:var(--font-display)] text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--cyan)]">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

const HAZARD_STYLE: Record<
  SoundingParams["hazard"],
  string
> = {
  NONE: "border-white/15 bg-white/5 text-white/70",
  HAIL: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  WIND: "border-orange-400/40 bg-orange-400/10 text-orange-200",
  TORNADO: "border-rose-400/50 bg-rose-500/15 text-rose-200",
  "HEAVY RAIN": "border-sky-400/40 bg-sky-400/10 text-sky-200",
};

export function SoundingParamsTables({
  params,
  engine = "legacy",
  engineHemisphere,
  engineMessage,
}: {
  params: SoundingParams;
  engine?: "skywatch-ai" | "skywatch-ai-v1" | "legacy";
  engineHemisphere?: string;
  engineMessage?: string;
}) {
  const neural = engine === "skywatch-ai-v1";
  const ai = engine === "skywatch-ai" || neural;
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug",
          neural
            ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
            : ai
              ? "border-cyan-400/35 bg-cyan-400/10 text-cyan-100"
              : "border-white/12 bg-white/[0.04] text-white/55",
        )}
      >
        <span className="font-semibold tracking-wide">
          {neural
            ? "StormFront Australia experimental model"
            : ai
              ? "StormFront Australia weather model"
              : "Legacy thermo"}
        </span>
        {ai && engineHemisphere ? (
          <span className="text-white/50">
            {" "}
            · Southern Hemisphere storm-rotation calculation
          </span>
        ) : null}
        {engineMessage ? (
          <p className="mt-0.5 text-white/45">{engineMessage}</p>
        ) : null}
      </div>

      <div
        className={cn(
          "rounded-xl border px-3 py-2 text-center font-[family-name:var(--font-display)] text-sm font-bold tracking-wide",
          HAZARD_STYLE[params.hazard],
        )}
      >
        Primary hazard · {params.hazard}
      </div>

      <Panel title="Storm potential">
        {params.parcels.map((p) => (
          <div key={p.id} className="mb-2">
            <p className="mb-0.5 text-[11px] font-semibold text-white/70">
              {p.label} ({p.id})
            </p>
            <Row label="Storm energy (CAPE)" value={fmt(p.cape, 0, " J/kg")} accent />
            <Row label="Storm suppression (CIN)" value={fmt(p.cin, 0, " J/kg")} />
            <Row label="Cloud base" value={`${fmt(p.lclHpa, 0, " hPa")} · ${fmt(p.lclM, 0, " m")}`} />
            <Row label="Storm start / top" value={`${fmt(p.lfcHpa)} / ${fmt(p.elHpa)} hPa`} />
            <Row label="Thunderstorm index (LI)" value={fmt(p.li, 1)} />
          </div>
        ))}
      </Panel>

      <Panel title="Moisture">
        <Row label="Moisture available for rain" value={fmt(params.pwMm, 1, " mm")} accent />
        <Row label="Thunderstorm index (K)" value={fmt(params.kIndex)} />
        <Row label="Thunderstorm index (TT)" value={fmt(params.totalTotals)} />
        <Row label="Humidity at mid-level" value={fmt(params.midRhPct, 0, "%")} />
        <Row label="Downdraft potential (DCAPE)" value={fmt(params.dcape, 0, " J/kg")} />
      </Panel>

      <Panel title="Temperature change with height">
        <Row label="0–3 km" value={fmt(params.lapse0to3, 1, " °C/km")} />
        <Row label="3–6 km" value={fmt(params.lapse3to6, 1, " °C/km")} />
        <Row label="850–500 hPa" value={fmt(params.lapse850to500, 1, " °C/km")} />
        <Row label="700–500 hPa" value={fmt(params.lapse700to500, 1, " °C/km")} accent />
      </Panel>

      <Panel title="Wind change with height">
        <Row label="0–1 km" value={fmt(params.shear0to1Kts, 1, " kt")} />
        <Row label="0–3 km" value={fmt(params.shear0to3Kts, 1, " kt")} />
        <Row label="0–6 km" value={fmt(params.shear0to6Kts, 1, " kt")} accent />
        <Row label="Storm rotation potential, lower levels" value={fmt(params.srh0to1, 0, " m²/s²")} />
        <Row label="Storm rotation potential, deeper layer" value={fmt(params.srh0to3, 0, " m²/s²")} accent />
      </Panel>

      <Panel title="Storm motion">
        <Row
          label="Mean 0–6 km"
          value={
            params.meanWind0to6Dir != null
              ? `${fmt(params.meanWind0to6Dir)}° / ${fmt(params.meanWind0to6Kts, 1)} kt`
              : "—"
          }
        />
        <Row
          label="Right-moving storm estimate"
          value={
            params.bunkersRightDir != null
              ? `${fmt(params.bunkersRightDir)}° / ${fmt(params.bunkersRightKts, 1)} kt`
              : "—"
          }
          accent
        />
        <Row
          label="Bunkers LM"
          value={
            params.bunkersLeftDir != null
              ? `${fmt(params.bunkersLeftDir)}° / ${fmt(params.bunkersLeftKts, 1)} kt`
              : "—"
          }
        />
      </Panel>

      <Panel title="Composite">
        <Row label="SCP" value={fmt(params.supercellComposite, 2)} accent />
        <Row label="STP" value={fmt(params.stp, 2)} />
        <Row label="SHIP" value={fmt(params.ship, 2)} />
      </Panel>
    </div>
  );
}
