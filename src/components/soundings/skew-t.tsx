"use client";

import { useMemo } from "react";
import type { ParcelTrace, SoundingLevel } from "@/lib/weather/sounding-types";

const W = 640;
const H = 720;
const PAD = { l: 48, r: 72, t: 28, b: 36 };
const P_TOP = 100;
const P_BOT = 1050;
const T_MIN = -50;
const T_MAX = 45;
const SKEW = 0.55;

function yOfP(p: number): number {
  const logP = Math.log(p);
  const logTop = Math.log(P_TOP);
  const logBot = Math.log(P_BOT);
  return PAD.t + ((logP - logTop) / (logBot - logTop)) * (H - PAD.t - PAD.b);
}

function xOfT(t: number, p: number): number {
  const skew = SKEW * (Math.log(P_BOT) - Math.log(p));
  const tSkew = t + skew * 40;
  return (
    PAD.l +
    ((tSkew - T_MIN) / (T_MAX - T_MIN)) * (W - PAD.l - PAD.r)
  );
}

function pathFrom(
  pts: { t: number; p: number }[],
): string {
  if (!pts.length) return "";
  return pts
    .map((pt, i) => `${i === 0 ? "M" : "L"}${xOfT(pt.t, pt.p).toFixed(1)},${yOfP(pt.p).toFixed(1)}`)
    .join(" ");
}

function windBarb(
  x: number,
  y: number,
  dir: number,
  spdMs: number,
): string {
  const kts = spdMs * 1.94384;
  const rad = ((dir + 180) * Math.PI) / 180;
  const len = 22;
  const x2 = x + Math.sin(rad) * len;
  const y2 = y - Math.cos(rad) * len;
  let d = `M${x},${y}L${x2.toFixed(1)},${y2.toFixed(1)}`;
  let remaining = Math.round(kts / 5) * 5;
  let along = 0;
  const px = Math.sin(rad);
  const py = -Math.cos(rad);
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  while (remaining >= 50) {
    const bx = x2 - px * along;
    const by = y2 - py * along;
    d += `M${bx.toFixed(1)},${by.toFixed(1)}L${(bx + nx * 9 - px * 4).toFixed(1)},${(by + ny * 9 - py * 4).toFixed(1)}L${(bx - px * 8).toFixed(1)},${(by - py * 8).toFixed(1)}`;
    remaining -= 50;
    along += 8;
  }
  while (remaining >= 10) {
    const bx = x2 - px * along;
    const by = y2 - py * along;
    d += `M${bx.toFixed(1)},${by.toFixed(1)}L${(bx + nx * 8).toFixed(1)},${(by + ny * 8).toFixed(1)}`;
    remaining -= 10;
    along += 5;
  }
  if (remaining >= 5) {
    const bx = x2 - px * along;
    const by = y2 - py * along;
    d += `M${bx.toFixed(1)},${by.toFixed(1)}L${(bx + nx * 4).toFixed(1)},${(by + ny * 4).toFixed(1)}`;
  }
  return d;
}

function dryAdiabatTemps(thetaC: number): { t: number; p: number }[] {
  const pts: { t: number; p: number }[] = [];
  for (let p = P_BOT; p >= P_TOP; p -= 25) {
    const t = (thetaC + 273.15) * (p / 1000) ** 0.286 - 273.15;
    pts.push({ t, p });
  }
  return pts;
}

function mixRatioLine(rGkg: number): { t: number; p: number }[] {
  // dewpoint for constant mixing ratio
  const r = rGkg / 1000;
  const pts: { t: number; p: number }[] = [];
  for (let p = P_BOT; p >= 400; p -= 25) {
    const e = (r * p) / (0.622 + r);
    const td = (243.5 * Math.log(e / 6.112)) / (17.67 - Math.log(e / 6.112));
    if (Number.isFinite(td)) pts.push({ t: td, p });
  }
  return pts;
}

type Props = {
  levels: SoundingLevel[];
  parcelTraces: ParcelTrace[];
  activeParcel?: "SFC" | "ML" | "MU";
};

export function SkewTChart({
  levels,
  parcelTraces,
  activeParcel = "SFC",
}: Props) {
  const { tPath, tdPath, barbs, isotherms, isobars, adiabats, mixLines, parcelPath } =
    useMemo(() => {
      const tPath = pathFrom(levels.map((l) => ({ t: l.t, p: l.p })));
      const tdPath = pathFrom(levels.map((l) => ({ t: l.td, p: l.p })));
      const barbX = W - PAD.r + 28;
      const barbs = levels
        .filter(
          (l, i) =>
            l.windDir != null &&
            l.windSpd != null &&
            l.p <= 1000 &&
            (i % Math.max(1, Math.floor(levels.length / 18)) === 0 ||
              l.p === 850 ||
              l.p === 700 ||
              l.p === 500 ||
              l.p === 300),
        )
        .map((l) =>
          windBarb(barbX, yOfP(l.p), l.windDir!, l.windSpd!),
        );

      const isotherms: string[] = [];
      for (let t = T_MIN; t <= T_MAX; t += 10) {
        const pts: { t: number; p: number }[] = [];
        for (let p = P_BOT; p >= P_TOP; p -= 25) pts.push({ t, p });
        isotherms.push(pathFrom(pts));
      }

      const isobars: { y: number; p: number }[] = [];
      for (const p of [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100]) {
        isobars.push({ y: yOfP(p), p });
      }

      const adiabats = [-30, -20, -10, 0, 10, 20, 30, 40].map((th) =>
        pathFrom(dryAdiabatTemps(th)),
      );
      const mixLines = [0.4, 1, 2, 4, 8, 12, 16, 20].map((r) =>
        pathFrom(mixRatioLine(r)),
      );

      const parcel = parcelTraces.find((p) => p.id === activeParcel);
      const parcelPath = parcel ? pathFrom(parcel.points) : "";

      return {
        tPath,
        tdPath,
        barbs,
        isotherms,
        isobars,
        adiabats,
        mixLines,
        parcelPath,
      };
    }, [levels, parcelTraces, activeParcel]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      role="img"
      aria-label="Skew-T log-P diagram"
    >
      <rect width={W} height={H} fill="#070b16" />
      <rect
        x={PAD.l}
        y={PAD.t}
        width={W - PAD.l - PAD.r}
        height={H - PAD.t - PAD.b}
        fill="#0b1224"
        stroke="rgba(255,255,255,0.12)"
      />

      {adiabats.map((d, i) => (
        <path
          key={`ad-${i}`}
          d={d}
          fill="none"
          stroke="rgba(251,191,36,0.18)"
          strokeWidth={1}
        />
      ))}
      {mixLines.map((d, i) => (
        <path
          key={`mx-${i}`}
          d={d}
          fill="none"
          stroke="rgba(52,211,153,0.22)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}
      {isotherms.map((d, i) => (
        <path
          key={`iso-${i}`}
          d={d}
          fill="none"
          stroke={i === 5 ? "rgba(248,113,113,0.45)" : "rgba(255,255,255,0.08)"}
          strokeWidth={i === 5 ? 1.25 : 1}
        />
      ))}
      {isobars.map(({ y, p }) => (
        <g key={p}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.12)"
          />
          <text
            x={PAD.l - 8}
            y={y + 4}
            textAnchor="end"
            fill="rgba(255,255,255,0.55)"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
          >
            {p}
          </text>
        </g>
      ))}

      {/* 0°C isotherm label */}
      <text
        x={xOfT(0, 1000)}
        y={H - 10}
        textAnchor="middle"
        fill="rgba(248,113,113,0.8)"
        fontSize={11}
        fontFamily="Oswald, sans-serif"
      >
        0°C
      </text>

      {parcelPath ? (
        <path
          d={parcelPath}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={2}
          strokeDasharray="6 3"
          opacity={0.95}
        />
      ) : null}

      <path
        d={tdPath}
        fill="none"
        stroke="#34d399"
        strokeWidth={2.25}
        strokeLinejoin="round"
      />
      <path
        d={tPath}
        fill="none"
        stroke="#f87171"
        strokeWidth={2.25}
        strokeLinejoin="round"
      />

      {barbs.map((d, i) => (
        <path
          key={`barb-${i}`}
          d={d}
          fill="none"
          stroke="#e8eef9"
          strokeWidth={1.2}
        />
      ))}

      <text
        x={PAD.l}
        y={18}
        fill="#67e8f9"
        fontSize={13}
        fontFamily="Oswald, sans-serif"
        fontWeight={600}
      >
        Skew-T log-P
      </text>
      <text
        x={W - PAD.r}
        y={18}
        textAnchor="end"
        fill="rgba(255,255,255,0.45)"
        fontSize={11}
        fontFamily="ui-monospace, monospace"
      >
        T · Td · {activeParcel} parcel
      </text>
    </svg>
  );
}
