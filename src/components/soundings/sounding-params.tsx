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

export function SoundingParamsTables({ params }: { params: SoundingParams }) {
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-xl border px-3 py-2 text-center font-[family-name:var(--font-display)] text-sm font-bold tracking-wide",
          HAZARD_STYLE[params.hazard],
        )}
      >
        Primary hazard · {params.hazard}
      </div>

      <Panel title="Thermo">
        {params.parcels.map((p) => (
          <div key={p.id} className="mb-2">
            <p className="mb-0.5 text-[11px] font-semibold text-white/70">
              {p.label} ({p.id})
            </p>
            <Row label="CAPE" value={fmt(p.cape, 0, " J/kg")} accent />
            <Row label="CIN" value={fmt(p.cin, 0, " J/kg")} />
            <Row label="LCL" value={`${fmt(p.lclHpa, 0, " hPa")} · ${fmt(p.lclM, 0, " m")}`} />
            <Row label="LFC / EL" value={`${fmt(p.lfcHpa)} / ${fmt(p.elHpa)} hPa`} />
            <Row label="LI" value={fmt(p.li, 1)} />
          </div>
        ))}
      </Panel>

      <Panel title="Moisture">
        <Row label="Precipitable water" value={fmt(params.pwMm, 1, " mm")} accent />
        <Row label="K-index" value={fmt(params.kIndex)} />
        <Row label="Total totals" value={fmt(params.totalTotals)} />
        <Row label="Mid-level RH" value={fmt(params.midRhPct, 0, "%")} />
        <Row label="DCAPE" value={fmt(params.dcape, 0, " J/kg")} />
      </Panel>

      <Panel title="Lapse rates">
        <Row label="0–3 km" value={fmt(params.lapse0to3, 1, " °C/km")} />
        <Row label="3–6 km" value={fmt(params.lapse3to6, 1, " °C/km")} />
        <Row label="850–500 hPa" value={fmt(params.lapse850to500, 1, " °C/km")} />
        <Row label="700–500 hPa" value={fmt(params.lapse700to500, 1, " °C/km")} accent />
      </Panel>

      <Panel title="Shear">
        <Row label="0–1 km" value={fmt(params.shear0to1Kts, 1, " kt")} />
        <Row label="0–3 km" value={fmt(params.shear0to3Kts, 1, " kt")} />
        <Row label="0–6 km" value={fmt(params.shear0to6Kts, 1, " kt")} accent />
        <Row label="SRH 0–1 km" value={fmt(params.srh0to1, 0, " m²/s²")} />
        <Row label="SRH 0–3 km" value={fmt(params.srh0to3, 0, " m²/s²")} accent />
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
          label="Bunkers RM"
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
