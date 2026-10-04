/**
 * Classical sounding diagnostics (SHARPpy-style subset).
 * Temperatures °C, pressure hPa, heights m, winds m/s.
 */

import type {
  ParcelRow,
  ParcelTrace,
  SoundingLevel,
  SoundingParams,
} from "@/lib/weather/sounding-types";

const K0 = 273.15;
const RD = 287.05;
const CP = 1005.7;
const LV = 2.5e6;
const EPSILON = 0.622;
const P0 = 1000;
const G = 9.80665;
const KAPPA = RD / CP;

export type SoundingAnalysis = {
  params: SoundingParams;
  parcelTraces: ParcelTrace[];
};

function emptyParams(): SoundingParams {
  return {
    parcels: [
      emptyParcel("SFC", "Surface"),
      emptyParcel("ML", "Mixed-layer"),
      emptyParcel("MU", "Most-unstable"),
    ],
    pwMm: null,
    kIndex: null,
    totalTotals: null,
    midRhPct: null,
    dcape: null,
    lapse0to3: null,
    lapse3to6: null,
    lapse850to500: null,
    lapse700to500: null,
    shear0to1Kts: null,
    shear0to3Kts: null,
    shear0to6Kts: null,
    srh0to1: null,
    srh0to3: null,
    meanWind0to6Dir: null,
    meanWind0to6Kts: null,
    bunkersRightDir: null,
    bunkersRightKts: null,
    bunkersLeftDir: null,
    bunkersLeftKts: null,
    supercellComposite: null,
    stp: null,
    ship: null,
    hazard: "NONE",
  };
}

function emptyParcel(id: ParcelRow["id"], label: string): ParcelRow {
  return {
    id,
    label,
    cape: null,
    cin: null,
    lclHpa: null,
    lclM: null,
    li: null,
    lfcHpa: null,
    elHpa: null,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Bolton (1980) saturation vapor pressure hPa from °C. */
export function esat(tC: number): number {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

export function mixingRatio(tdC: number, pHpa: number): number {
  const e = esat(tdC);
  return (EPSILON * e) / Math.max(pHpa - e, 0.1);
}

export function potentialTemp(tC: number, pHpa: number): number {
  return (tC + K0) * (P0 / pHpa) ** KAPPA - K0;
}

export function thetaE(tC: number, tdC: number, pHpa: number): number {
  const r = mixingRatio(tdC, pHpa);
  const tl = 1 / (1 / (tdC + K0 - 56) + Math.log((tC + K0) / (tdC + K0)) / 800) + 56;
  const thL =
    (tC + K0) *
    (P0 / (pHpa - esat(tdC))) ** KAPPA *
    (tC + K0) / tl ** (0.28 * r);
  return thL * Math.exp((3036 / tl - 1.78) * r * (1 + 0.448 * r)) - K0;
}

function rhFromTTd(tC: number, tdC: number): number {
  return clamp((100 * esat(tdC)) / Math.max(esat(tC), 1e-6), 0, 100);
}

/** Lift dry adiabatically from (t,p) to p2. */
function liftDry(tC: number, pFrom: number, pTo: number): number {
  return (tC + K0) * (pTo / pFrom) ** KAPPA - K0;
}

/**
 * Approximate moist-adiabatic lapse: iterate small pressure steps.
 * Returns temperature °C at pTo starting from saturated parcel at pFrom.
 */
function liftMoist(tC: number, pFrom: number, pTo: number): number {
  if (pTo >= pFrom) return tC;
  let t = tC;
  let p = pFrom;
  const steps = Math.max(8, Math.round((pFrom - pTo) / 10));
  const dp = (pFrom - pTo) / steps;
  for (let i = 0; i < steps; i++) {
    const pNext = p - dp;
    const tk = t + K0;
    const r = mixingRatio(t, p); // saturated
    const numer = (RD * tk) / p + (LV * r) / p;
    const denom = CP + (LV * LV * r * EPSILON) / (RD * tk * tk);
    // dT/dp ≈ (Γ) using hydrostatic: dT = Γ_m * dz, dz = -Rd T dp /(p g)
    const gamma = (gMoist(tk, r) * RD * tk) / (p * G);
    // Use Bolton-ish finite step via potential temp of saturated parcel
    const dTdp = ((RD * tk) / (p * CP)) * (1 + (LV * r) / (RD * tk)) /
      (1 + (EPSILON * LV * LV * r) / (CP * RD * tk * tk));
    void numer;
    void denom;
    void gamma;
    t = t - dTdp * dp;
    p = pNext;
  }
  return t;
}

function gMoist(tk: number, r: number): number {
  return (
    G *
    ((1 + (LV * r) / (RD * tk)) /
      (CP + (EPSILON * LV * LV * r) / (RD * tk * tk)))
  );
}

/** LCL pressure & temperature via Bolton. */
function lcl(tC: number, tdC: number, pHpa: number): { p: number; t: number } {
  const tk = tC + K0;
  const tdk = tdC + K0;
  const tl =
    1 / (1 / (tdk - 56) + Math.log(tk / tdk) / 800) + 56;
  const pLcl = pHpa * (tl / tk) ** (1 / KAPPA);
  return { p: pLcl, t: tl - K0 };
}

function interpTemp(levels: SoundingLevel[], pHpa: number): number | null {
  if (!levels.length) return null;
  if (pHpa >= levels[0]!.p) return levels[0]!.t;
  if (pHpa <= levels[levels.length - 1]!.p) return levels[levels.length - 1]!.t;
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i]!;
    const b = levels[i + 1]!;
    if (pHpa <= a.p && pHpa >= b.p) {
      const w = (Math.log(a.p) - Math.log(pHpa)) / (Math.log(a.p) - Math.log(b.p));
      return a.t + w * (b.t - a.t);
    }
  }
  return null;
}

function interpHeight(levels: SoundingLevel[], pHpa: number): number | null {
  if (!levels.length) return null;
  if (pHpa >= levels[0]!.p) return levels[0]!.z;
  if (pHpa <= levels[levels.length - 1]!.p) return levels[levels.length - 1]!.z;
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i]!;
    const b = levels[i + 1]!;
    if (pHpa <= a.p && pHpa >= b.p) {
      const w = (Math.log(a.p) - Math.log(pHpa)) / (Math.log(a.p) - Math.log(b.p));
      return a.z + w * (b.z - a.z);
    }
  }
  return null;
}

function heightAt(levels: SoundingLevel[], zM: number): SoundingLevel | null {
  if (!levels.length) return null;
  if (zM <= levels[0]!.z) return levels[0]!;
  if (zM >= levels[levels.length - 1]!.z) return levels[levels.length - 1]!;
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i]!;
    const b = levels[i + 1]!;
    if (zM >= a.z && zM <= b.z) {
      const w = (zM - a.z) / Math.max(b.z - a.z, 1);
      return {
        p: a.p + w * (b.p - a.p),
        z: zM,
        t: a.t + w * (b.t - a.t),
        td: a.td + w * (b.td - a.td),
        rh: a.rh != null && b.rh != null ? a.rh + w * (b.rh - a.rh) : null,
        windDir:
          a.windDir != null && b.windDir != null
            ? a.windDir + w * shortestAngleDiff(a.windDir, b.windDir)
            : a.windDir,
        windSpd:
          a.windSpd != null && b.windSpd != null
            ? a.windSpd + w * (b.windSpd - a.windSpd)
            : a.windSpd,
      };
    }
  }
  return null;
}

function shortestAngleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function windUV(dir: number | null, spd: number | null): { u: number; v: number } | null {
  if (dir == null || spd == null || !Number.isFinite(dir) || !Number.isFinite(spd)) {
    return null;
  }
  const rad = (dir * Math.PI) / 180;
  return { u: -spd * Math.sin(rad), v: -spd * Math.cos(rad) };
}

function uvToDirSpd(u: number, v: number): { dir: number; spd: number } {
  const spd = Math.hypot(u, v);
  let dir = (Math.atan2(-u, -v) * 180) / Math.PI;
  if (dir < 0) dir += 360;
  return { dir, spd };
}

function msToKt(ms: number): number {
  return ms * 1.94384;
}

type ParcelResult = {
  row: ParcelRow;
  trace: { p: number; t: number }[];
};

function liftParcel(
  levels: SoundingLevel[],
  startT: number,
  startTd: number,
  startP: number,
  id: ParcelRow["id"],
  label: string,
): ParcelResult {
  const row = emptyParcel(id, label);
  if (!levels.length || !Number.isFinite(startT) || !Number.isFinite(startTd)) {
    return { row, trace: [] };
  }

  const { p: pLcl, t: tLcl } = lcl(startT, startTd, startP);
  row.lclHpa = Math.round(pLcl * 10) / 10;
  row.lclM = interpHeight(levels, pLcl);

  const trace: { p: number; t: number }[] = [{ p: startP, t: startT }];
  // Build parcel T at each env level + LCL
  const pressures = [
    ...new Set(
      [startP, pLcl, ...levels.map((l) => l.p)].filter((p) => p <= startP + 0.5),
    ),
  ].sort((a, b) => b - a);

  for (const p of pressures) {
    if (p >= startP - 1e-6) {
      trace.push({ p: startP, t: startT });
      continue;
    }
    if (p > pLcl) {
      trace.push({ p, t: liftDry(startT, startP, p) });
    } else if (Math.abs(p - pLcl) < 0.05) {
      trace.push({ p: pLcl, t: tLcl });
    } else {
      // moist from LCL
      const t = liftMoist(tLcl, pLcl, p);
      trace.push({ p, t });
    }
  }

  // Deduplicate / sort
  const byP = new Map<number, number>();
  for (const pt of trace) byP.set(Math.round(pt.p * 100) / 100, pt.t);
  const path = [...byP.entries()]
    .map(([p, t]) => ({ p, t }))
    .sort((a, b) => b.p - a.p);

  // CAPE / CIN / LFC / EL via virtual-temp approx (use T)
  let cape = 0;
  let cin = 0;
  let lfc: number | null = null;
  let el: number | null = null;
  let belowLfc = true;
  let buoyant = false;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (a.p < 100) break;
    const envA = interpTemp(levels, a.p);
    const envB = interpTemp(levels, b.p);
    if (envA == null || envB == null) continue;
    const buoyA = a.t - envA;
    const buoyB = b.t - envB;
    const zA = interpHeight(levels, a.p);
    const zB = interpHeight(levels, b.p);
    if (zA == null || zB == null || zB <= zA) continue;
    const dz = zB - zA;
    const meanBuoy = 0.5 * (buoyA + buoyB);
    // Convert °C buoyancy to m/s² ≈ g * (Tp-Te)/Te
    const te = envA + K0;
    const accel = (G * meanBuoy) / te;
    const work = accel * dz;

    if (a.p <= pLcl) {
      if (belowLfc) {
        if (meanBuoy > 0 && buoyA <= 0 && buoyB > 0) {
          lfc = b.p;
          belowLfc = false;
          buoyant = true;
        } else if (meanBuoy > 0 && buoyA > 0) {
          lfc = lfc ?? a.p;
          belowLfc = false;
          buoyant = true;
        }
        if (belowLfc && work < 0) cin += -work;
        else if (!belowLfc && work > 0) cape += work;
      } else {
        if (work > 0) {
          cape += work;
          buoyant = true;
        } else if (buoyant && meanBuoy < 0 && el == null) {
          el = a.p;
        }
      }
    }
  }

  row.cape = Math.round(Math.max(0, cape));
  row.cin = Math.round(Math.max(0, cin));
  row.lfcHpa = lfc != null ? Math.round(lfc * 10) / 10 : null;
  row.elHpa = el != null ? Math.round(el * 10) / 10 : null;

  const t500 = interpTemp(levels, 500);
  const pT500 = path.find((pt) => Math.abs(pt.p - 500) < 8)?.t;
  const parcel500 =
    pT500 ??
    (pLcl > 500
      ? liftDry(startT, startP, 500)
      : liftMoist(tLcl, pLcl, 500));
  row.li = t500 != null ? Math.round((t500 - parcel500) * 10) / 10 : null;

  return { row, trace: path };
}

function precipitableWaterMm(levels: SoundingLevel[]): number | null {
  if (levels.length < 2) return null;
  let sum = 0;
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i]!;
    const b = levels[i + 1]!;
    const ra = mixingRatio(a.td, a.p);
    const rb = mixingRatio(b.td, b.p);
    // PW ≈ (1/g) ∫ r dp  (r kg/kg, dp Pa) → mm
    const dpPa = (a.p - b.p) * 100;
    if (dpPa <= 0) continue;
    sum += 0.5 * (ra + rb) * dpPa;
  }
  return Math.round((sum / G) * 10) / 10;
}

function layerMeanWind(
  levels: SoundingLevel[],
  zBot: number,
  zTop: number,
): { u: number; v: number } | null {
  const samples: { u: number; v: number; z: number }[] = [];
  for (let z = zBot; z <= zTop; z += 250) {
    const lv = heightAt(levels, levels[0]!.z + z);
    if (!lv) continue;
    const uv = windUV(lv.windDir, lv.windSpd);
    if (!uv) continue;
    samples.push({ ...uv, z });
  }
  if (samples.length < 2) return null;
  const u = samples.reduce((s, x) => s + x.u, 0) / samples.length;
  const v = samples.reduce((s, x) => s + x.v, 0) / samples.length;
  return { u, v };
}

function bulkShearKts(
  levels: SoundingLevel[],
  zBot: number,
  zTop: number,
): number | null {
  const sfc = heightAt(levels, levels[0]!.z + zBot);
  const top = heightAt(levels, levels[0]!.z + zTop);
  if (!sfc || !top) return null;
  const a = windUV(sfc.windDir, sfc.windSpd);
  const b = windUV(top.windDir, top.windSpd);
  if (!a || !b) return null;
  return Math.round(msToKt(Math.hypot(b.u - a.u, b.v - a.v)) * 10) / 10;
}

function stormRelativeHelicity(
  levels: SoundingLevel[],
  zBot: number,
  zTop: number,
  stormU: number,
  stormV: number,
): number | null {
  const sfcZ = levels[0]!.z;
  let srh = 0;
  let prev: { u: number; v: number } | null = null;
  for (let z = zBot; z <= zTop; z += 100) {
    const lv = heightAt(levels, sfcZ + z);
    if (!lv) continue;
    const uv = windUV(lv.windDir, lv.windSpd);
    if (!uv) continue;
    if (prev) {
      const du = uv.u - prev.u;
      const dv = uv.v - prev.v;
      const ru = prev.u - stormU;
      const rv = prev.v - stormV;
      srh += ru * dv - rv * du;
    }
    prev = uv;
  }
  if (prev == null) return null;
  return Math.round(srh);
}

function lapseRate(
  levels: SoundingLevel[],
  zBot: number,
  zTop: number,
): number | null {
  const a = heightAt(levels, levels[0]!.z + zBot);
  const b = heightAt(levels, levels[0]!.z + zTop);
  if (!a || !b || b.z <= a.z) return null;
  return Math.round(((a.t - b.t) / ((b.z - a.z) / 1000)) * 10) / 10;
}

function lapseP(
  levels: SoundingLevel[],
  pBot: number,
  pTop: number,
): number | null {
  const tBot = interpTemp(levels, pBot);
  const tTop = interpTemp(levels, pTop);
  const zBot = interpHeight(levels, pBot);
  const zTop = interpHeight(levels, pTop);
  if (tBot == null || tTop == null || zBot == null || zTop == null) return null;
  if (zTop <= zBot) return null;
  return Math.round(((tBot - tTop) / ((zTop - zBot) / 1000)) * 10) / 10;
}

function estimateDcape(levels: SoundingLevel[]): number | null {
  // Downdraft CAPE: lowest θe in 700–500 hPa lowered moist-adiabatically to sfc.
  const mid = levels.filter((l) => l.p <= 700 && l.p >= 500);
  if (!mid.length || !levels[0]) return null;
  let minTe = Infinity;
  let seed: SoundingLevel | null = null;
  for (const l of mid) {
    const te = thetaE(l.t, l.td, l.p);
    if (te < minTe) {
      minTe = te;
      seed = l;
    }
  }
  if (!seed) return null;
  // Approximate: integrate negative buoyancy of saturated descent to surface
  let t = seed.t;
  let p = seed.p;
  let dcape = 0;
  const sfc = levels[0]!;
  const steps = 20;
  const dp = (sfc.p - seed.p) / steps;
  for (let i = 0; i < steps; i++) {
    const pNext = p + dp;
    const tNext = liftMoist(t, p, Math.min(p, pNext)); // ascending formula inverted poorly
    // Better: dry-ish cool by moist adiabat upward inverse — use wet-bulb approx at next p
    const env = interpTemp(levels, pNext);
    // Parcel descends along moist adiabat: temperature at higher p
    const tDesc = moistTempAtP(seed.t, seed.p, pNext);
    if (env != null) {
      const zA = interpHeight(levels, p);
      const zB = interpHeight(levels, pNext);
      if (zA != null && zB != null && zA > zB) {
        const meanBuoy = 0.5 * (t - env + (tDesc - env));
        if (meanBuoy < 0) {
          const te = env + K0;
          dcape += (-(G * meanBuoy) / te) * (zA - zB);
        }
      }
    }
    t = tDesc;
    p = pNext;
    void tNext;
  }
  return Math.round(Math.max(0, dcape));
}

function moistTempAtP(tSat: number, pSat: number, pTarget: number): number {
  if (pTarget <= pSat) return liftMoist(tSat, pSat, pTarget);
  // Ascend then... for descent, iterate upward from target with guess
  let lo = tSat - 40;
  let hi = tSat + 40;
  for (let i = 0; i < 24; i++) {
    const mid = 0.5 * (lo + hi);
    const lifted = liftMoist(mid, pTarget, pSat);
    if (lifted > tSat) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

function classifyHazard(p: SoundingParams): SoundingParams["hazard"] {
  const sfc = p.parcels.find((x) => x.id === "SFC");
  const mu = p.parcels.find((x) => x.id === "MU");
  const cape = Math.max(sfc?.cape ?? 0, mu?.cape ?? 0);
  const srh = Math.max(p.srh0to1 ?? 0, p.srh0to3 ?? 0);
  const shear6 = p.shear0to6Kts ?? 0;
  const stp = p.stp ?? 0;
  const ship = p.ship ?? 0;
  const pw = p.pwMm ?? 0;
  const midRh = p.midRhPct ?? 50;
  const lapse = p.lapse700to500 ?? 0;

  if (stp >= 1 && srh >= 150 && cape >= 500) return "TORNADO";
  if (ship >= 1 && cape >= 1000 && lapse >= 6.5) return "HAIL";
  if (cape >= 800 && shear6 >= 35 && midRh < 45) return "WIND";
  if (pw >= 40 && cape >= 500 && midRh >= 60) return "HEAVY RAIN";
  if (cape >= 1000 && shear6 >= 30) return "HAIL";
  return "NONE";
}

export function analyzeSounding(levelsIn: SoundingLevel[]): SoundingAnalysis {
  const levels = levelsIn
    .filter(
      (l) =>
        Number.isFinite(l.p) &&
        Number.isFinite(l.t) &&
        Number.isFinite(l.td) &&
        l.p > 50,
    )
    .map((l) => ({
      ...l,
      rh: l.rh ?? rhFromTTd(l.t, l.td),
      z: l.z > 0 ? l.z : Math.round(44330 * (1 - (l.p / 1013.25) ** 0.1903)),
    }))
    .sort((a, b) => b.p - a.p);

  if (levels.length < 5) {
    return { params: emptyParams(), parcelTraces: [] };
  }

  // Ensure monotonic heights
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]!.z <= levels[i - 1]!.z) {
      levels[i]!.z = levels[i - 1]!.z + 20;
    }
  }

  const sfc = levels[0]!;
  const sfcParcel = liftParcel(
    levels,
    sfc.t,
    sfc.td,
    sfc.p,
    "SFC",
    "Surface",
  );

  // Mixed layer: lowest 100 hPa mean T/Td
  const mlTopP = sfc.p - 100;
  const mlLevels = levels.filter((l) => l.p >= mlTopP);
  let mlT = sfc.t;
  let mlTd = sfc.td;
  if (mlLevels.length) {
    mlT = mlLevels.reduce((s, l) => s + l.t, 0) / mlLevels.length;
    mlTd = mlLevels.reduce((s, l) => s + l.td, 0) / mlLevels.length;
  }
  const mlParcel = liftParcel(levels, mlT, mlTd, sfc.p, "ML", "Mixed-layer");

  // Most unstable: max θe in lowest 300 hPa
  let muLevel = sfc;
  let maxTe = -Infinity;
  for (const l of levels) {
    if (l.p < sfc.p - 300) break;
    const te = thetaE(l.t, l.td, l.p);
    if (te > maxTe) {
      maxTe = te;
      muLevel = l;
    }
  }
  const muParcel = liftParcel(
    levels,
    muLevel.t,
    muLevel.td,
    muLevel.p,
    "MU",
    "Most-unstable",
  );

  const params = emptyParams();
  params.parcels = [sfcParcel.row, mlParcel.row, muParcel.row];
  params.pwMm = precipitableWaterMm(levels);

  const t850 = interpTemp(levels, 850);
  const t700 = interpTemp(levels, 700);
  const t500 = interpTemp(levels, 500);
  const td850 = (() => {
    const l = levels.find((x) => Math.abs(x.p - 850) < 20);
    return l?.td ?? null;
  })();
  const td700 = (() => {
    const l = levels.find((x) => Math.abs(x.p - 700) < 20);
    return l?.td ?? null;
  })();

  if (t850 != null && t700 != null && t500 != null && td850 != null && td700 != null) {
    params.kIndex = Math.round(t850 - t500 + td850 - (t700 - td700));
    params.totalTotals = Math.round(t850 + td850 - 2 * t500);
  }

  const mid = levels.filter((l) => l.p <= 700 && l.p >= 500);
  if (mid.length) {
    params.midRhPct = Math.round(
      mid.reduce((s, l) => s + (l.rh ?? rhFromTTd(l.t, l.td)), 0) / mid.length,
    );
  }

  params.dcape = estimateDcape(levels);
  params.lapse0to3 = lapseRate(levels, 0, 3000);
  params.lapse3to6 = lapseRate(levels, 3000, 6000);
  params.lapse850to500 = lapseP(levels, 850, 500);
  params.lapse700to500 = lapseP(levels, 700, 500);

  params.shear0to1Kts = bulkShearKts(levels, 0, 1000);
  params.shear0to3Kts = bulkShearKts(levels, 0, 3000);
  params.shear0to6Kts = bulkShearKts(levels, 0, 6000);

  const mean06 = layerMeanWind(levels, 0, 6000);
  const shear06uv = (() => {
    const a = heightAt(levels, levels[0]!.z);
    const b = heightAt(levels, levels[0]!.z + 6000);
    if (!a || !b) return null;
    const ua = windUV(a.windDir, a.windSpd);
    const ub = windUV(b.windDir, b.windSpd);
    if (!ua || !ub) return null;
    return { u: ub.u - ua.u, v: ub.v - ua.v };
  })();

  if (mean06) {
    const mw = uvToDirSpd(mean06.u, mean06.v);
    params.meanWind0to6Dir = Math.round(mw.dir);
    params.meanWind0to6Kts = Math.round(msToKt(mw.spd) * 10) / 10;
  }

  let brU = 0;
  let brV = 0;
  let blU = 0;
  let blV = 0;
  if (mean06 && shear06uv) {
    const shMag = Math.hypot(shear06uv.u, shear06uv.v) || 1;
    // Bunkers: ±7.5 m/s perpendicular to 0-6 km shear
    const du = (7.5 * shear06uv.v) / shMag;
    const dv = (-7.5 * shear06uv.u) / shMag;
    brU = mean06.u + du;
    brV = mean06.v + dv;
    blU = mean06.u - du;
    blV = mean06.v - dv;
    const br = uvToDirSpd(brU, brV);
    const bl = uvToDirSpd(blU, blV);
    params.bunkersRightDir = Math.round(br.dir);
    params.bunkersRightKts = Math.round(msToKt(br.spd) * 10) / 10;
    params.bunkersLeftDir = Math.round(bl.dir);
    params.bunkersLeftKts = Math.round(msToKt(bl.spd) * 10) / 10;
  }

  params.srh0to1 = stormRelativeHelicity(levels, 0, 1000, brU, brV);
  params.srh0to3 = stormRelativeHelicity(levels, 0, 3000, brU, brV);

  const mucape = muParcel.row.cape ?? 0;
  const srh3 = Math.max(params.srh0to3 ?? 0, 0);
  const shear6ms = (params.shear0to6Kts ?? 0) / 1.94384;
  const ebwd = Math.max(shear6ms, 0);
  // SCP ≈ (muCAPE/1000) * (SRH03/50) * (EBWD/20)
  params.supercellComposite =
    Math.round(
      (mucape / 1000) * (srh3 / 50) * (Math.min(ebwd, 20) / 20) * 100,
    ) / 100;

  const mlcape = mlParcel.row.cape ?? 0;
  const srh1 = Math.max(params.srh0to1 ?? 0, 0);
  const lclM = mlParcel.row.lclM ?? 1500;
  const lclTerm = clamp((2000 - lclM) / 1500, 0, 1);
  // Effective STP-like
  params.stp =
    Math.round(
      (mlcape / 1500) *
        (srh1 / 150) *
        (ebwd / 20) *
        lclTerm *
        100,
    ) / 100;

  // SHIP-like hail param
  const lapse75 = params.lapse700to500 ?? 0;
  const t500v = t500 ?? -10;
  const mixingSfc = mixingRatio(sfc.td, sfc.p) * 1000; // g/kg
  params.ship =
    Math.round(
      (mucape / 1000) *
        (mixingSfc / 14) *
        (lapse75 / 7) *
        ((t500v + 20) / 10) *
        (ebwd / 20) *
        100,
    ) / 100;

  params.hazard = classifyHazard(params);

  return {
    params,
    parcelTraces: [
      { id: "SFC", points: sfcParcel.trace },
      { id: "ML", points: mlParcel.trace },
      { id: "MU", points: muParcel.trace },
    ],
  };
}
