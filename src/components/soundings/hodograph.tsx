"use client";

import { useMemo } from "react";
import type { SoundingLevel, SoundingParams } from "@/lib/weather/sounding-types";

const S = 320;
const CX = S / 2;
const CY = S / 2;
const MAX_KT = 80;

function uv(dir: number, spdMs: number) {
  const spdKt = spdMs * 1.94384;
  const rad = (dir * Math.PI) / 180;
  return { u: -spdKt * Math.sin(rad), v: -spdKt * Math.cos(rad) };
}

function toXY(u: number, v: number) {
  const scale = (S * 0.42) / MAX_KT;
  return { x: CX + u * scale, y: CY - v * scale };
}

function colorForZ(zAgl: number): string {
  if (zAgl < 1000) return "#f87171";
  if (zAgl < 3000) return "#22d3ee";
  if (zAgl < 6000) return "#a78bfa";
  return "#fbbf24";
}

type Props = {
  levels: SoundingLevel[];
  params: SoundingParams;
};

export function HodographChart({ levels, params }: Props) {
  const { segments, rings, stormPts, sfcZ } = useMemo(() => {
    const sfcZ = levels[0]?.z ?? 0;
    const pts: { x: number; y: number; z: number; color: string }[] = [];
    for (const l of levels) {
      if (l.windDir == null || l.windSpd == null) continue;
      if (l.z - sfcZ > 12000) break;
      const { u, v } = uv(l.windDir, l.windSpd);
      const { x, y } = toXY(u, v);
      pts.push({ x, y, z: l.z - sfcZ, color: colorForZ(l.z - sfcZ) });
    }
    const segments: { d: string; color: string }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      segments.push({
        d: `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`,
        color: a.color,
      });
    }
    const rings = [20, 40, 60, 80];
    const stormPts: { x: number; y: number; label: string; color: string }[] =
      [];
    if (params.bunkersRightDir != null && params.bunkersRightKts != null) {
      const rad = (params.bunkersRightDir * Math.PI) / 180;
      const u = -params.bunkersRightKts * Math.sin(rad);
      const v = -params.bunkersRightKts * Math.cos(rad);
      const p = toXY(u, v);
      stormPts.push({ ...p, label: "RM", color: "#f87171" });
    }
    if (params.bunkersLeftDir != null && params.bunkersLeftKts != null) {
      const rad = (params.bunkersLeftDir * Math.PI) / 180;
      const u = -params.bunkersLeftKts * Math.sin(rad);
      const v = -params.bunkersLeftKts * Math.cos(rad);
      const p = toXY(u, v);
      stormPts.push({ ...p, label: "LM", color: "#60a5fa" });
    }
    if (params.meanWind0to6Dir != null && params.meanWind0to6Kts != null) {
      const rad = (params.meanWind0to6Dir * Math.PI) / 180;
      const u = -params.meanWind0to6Kts * Math.sin(rad);
      const v = -params.meanWind0to6Kts * Math.cos(rad);
      const p = toXY(u, v);
      stormPts.push({ ...p, label: "MW", color: "#fbbf24" });
    }
    return { segments, rings, stormPts, sfcZ };
  }, [levels, params]);

  void sfcZ;

  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      className="h-full w-full"
      role="img"
      aria-label="Wind direction and speed at different heights"
    >
      <rect width={S} height={S} fill="#070b16" rx={8} />
      {rings.map((kt) => {
        const r = ((S * 0.42) / MAX_KT) * kt;
        return (
          <g key={kt}>
            <circle
              cx={CX}
              cy={CY}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
            />
            <text
              x={CX + r - 2}
              y={CY - 4}
              fill="rgba(255,255,255,0.4)"
              fontSize={10}
              fontFamily="ui-monospace, monospace"
            >
              {kt}
            </text>
          </g>
        );
      })}
      <line
        x1={16}
        x2={S - 16}
        y1={CY}
        y2={CY}
        stroke="rgba(255,255,255,0.1)"
      />
      <line
        x1={CX}
        x2={CX}
        y1={16}
        y2={S - 16}
        stroke="rgba(255,255,255,0.1)"
      />

      {segments.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill="none"
          stroke={s.color}
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {stormPts.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r={4.5} fill={p.color} />
          <text
            x={p.x + 7}
            y={p.y + 3}
            fill={p.color}
            fontSize={11}
            fontFamily="Oswald, sans-serif"
            fontWeight={600}
          >
            {p.label}
          </text>
        </g>
      ))}

      <text
        x={12}
        y={18}
        fill="#67e8f9"
        fontSize={13}
        fontFamily="Oswald, sans-serif"
        fontWeight={600}
      >
        Hodograph
      </text>
      <text
        x={12}
        y={S - 10}
        fill="rgba(255,255,255,0.4)"
        fontSize={10}
        fontFamily="ui-monospace, monospace"
      >
        0–1 km red · 1–3 cyan · 3–6 violet · &gt;6 gold
      </text>
    </svg>
  );
}
