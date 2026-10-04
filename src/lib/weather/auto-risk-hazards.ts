/**
 * Derive hazard-chance probabilities (%) from the same DayMetrics used for
 * categorical risk. Values are SPC-style “within ~40 km” guidance odds.
 */

import { australWetSeasonWeight } from "@/lib/weather/auto-risk-climate";
import {
  chanceBandsFor,
  chancePctToRank,
  type ModelRiskProduct,
} from "@/lib/weather/auto-risk-products";

export type DayMetricsLike = {
  cape: number;
  cin: number;
  dewpoint: number;
  temp: number;
  rh: number;
  precipProb: number;
  precipMm: number;
  rainMm: number;
  showersMm: number;
  weatherCode: number;
  shearKts: number;
  vpdMin: number;
  vpdMax: number;
  soilMoisture: number;
  blHeight: number;
  freezingLevelM: number;
  peakCin: number;
  dewDepression: number;
  afternoonRhMin: number;
  morningCloud: number;
  morningPrecipMm: number;
  pressureRiseHpa: number;
  peakWindKmh: number;
  liftTrigger: number;
  liftedIndex: number;
  diurnalHeating: number;
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  directRadiation: number;
};

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function clampPct(n: number) {
  return Math.max(0, Math.min(95, Math.round(n)));
}

function thunderCodeBoost(code: number): number {
  if (code === 99 || code === 96) return 1;
  if (code === 95 || code === 97) return 0.85;
  if (code >= 91 && code <= 94) return 0.55;
  if (code === 29 || code === 17 || code === 18 || code === 19) return 0.4;
  return 0;
}

export type HazardChances = {
  tstorm: number;
  hail: number;
  wind: number;
  rain: number;
  tornado: number;
};

/**
 * @param risk Composite/rank/suppress from scoreEnvironment
 */
export function scoreHazardChances(
  m: DayMetricsLike,
  lat: number,
  risk: { rank: number; hatch: 0 | 1 | 2; composite: number; suppress: number },
  opts?: { month?: number },
): HazardChances {
  const month = opts?.month ?? new Date().getUTCMonth() + 1;
  const wetSeason = australWetSeasonWeight(month, lat);
  const cape = Math.max(0, m.cape);
  const shear = clamp01(m.shearKts / 65);
  const tropical = lat >= -23.5;
  const subtrop = lat >= -28 && lat < -23.5;
  const moisture = clamp01((m.dewpoint - (tropical ? 14 : 12)) / (tropical ? 10 : 12));
  const suppress = clamp01(risk.suppress);
  const synoptic = clamp01(m.liftTrigger);
  const diurnal = clamp01(m.diurnalHeating);
  const thunder = thunderCodeBoost(m.weatherCode);
  const organised =
    shear >= 0.35 ||
    synoptic >= 0.4 ||
    thunder >= 0.85 ||
    (tropical && m.showersMm + m.rainMm >= 12 && cape >= 800);
  const convectivePrecip = Math.max(
    m.showersMm,
    m.rainMm * 0.85,
    m.precipMm * 0.7,
  );

  // —— Thunderstorm chance ——
  // Ladder from categorical rank, blended with continuous composite.
  const rankPct = [0, 14, 28, 40, 52, 62, 72, 82, 90][risk.rank] ?? 0;
  const compositePct = risk.composite * 95;
  let tstorm = Math.max(rankPct, compositePct) * (0.55 + 0.45 * suppress);
  if (thunder >= 0.85) tstorm = Math.max(tstorm, 55);
  else if (thunder >= 0.55) tstorm = Math.max(tstorm, 35);
  else if (thunder >= 0.4) tstorm = Math.max(tstorm, 20);
  // Tropical daylight / monsoon pulse floor — stronger in wet season.
  if (
    tropical &&
    cape >= (wetSeason >= 0.55 ? 120 : 200) &&
    moisture >= (wetSeason >= 0.55 ? 0.28 : 0.35) &&
    suppress >= (wetSeason >= 0.55 ? 0.28 : 0.35)
  ) {
    tstorm = Math.max(
      tstorm,
      14 + wetSeason * 8 + diurnal * (22 + wetSeason * 10),
    );
  } else if (
    subtrop &&
    wetSeason >= 0.35 &&
    cape >= 220 &&
    moisture >= 0.32 &&
    diurnal >= 0.3 &&
    suppress >= 0.35
  ) {
    tstorm = Math.max(tstorm, 12 + diurnal * 18);
  }
  if (risk.rank <= 0 && thunder < 0.4) tstorm = Math.min(tstorm, 8);

  // —— Large hail ——
  const fzOk =
    m.freezingLevelM <= 0
      ? 0.55 // unknown — don't zero; models often omit
      : m.freezingLevelM <= 3200
        ? 1
        : m.freezingLevelM <= 3800
          ? 0.75
          : m.freezingLevelM <= 4500
            ? 0.4
            : 0.15;
  const hailCore =
    clamp01(cape / 2800) * 0.4 +
    shear * 0.28 +
    fzOk * 0.12 +
    clamp01((moisture - 0.2) / 0.5) * 0.1 +
    (organised ? 0.1 : 0);
  let hail =
    hailCore *
    suppress *
    (risk.rank >= 3 ? 1 : risk.rank >= 2 ? 0.65 : 0.35) *
    70;
  if (cape < 800 || suppress < 0.3) hail *= 0.35;
  if (cape >= 2000 && shear >= 0.45 && fzOk >= 0.75) hail = Math.max(hail, 18);
  if (risk.hatch >= 1) hail = Math.max(hail, 12);
  if (thunder >= 0.85 && cape >= 1200) hail = Math.max(hail, 10);

  // —— Damaging winds ——
  const dryPunch = clamp01((m.vpdMax - 1.4) / 2.2); // steeper lapse / evaporative
  const gustProxy = clamp01(m.peakWindKmh / 70);
  const windCore =
    shear * 0.32 +
    clamp01(cape / 2400) * 0.28 +
    dryPunch * 0.12 +
    gustProxy * 0.12 +
    (organised ? 0.1 : 0) +
    synoptic * 0.06;
  let wind = windCore * suppress * 68;
  if (cape < 500 && shear < 0.25) wind *= 0.3;
  if (shear >= 0.5 && cape >= 1200) wind = Math.max(wind, 16);
  if (m.peakWindKmh >= 50 && cape >= 600) wind = Math.max(wind, 12);
  // Pulse microburst path: high CAPE, modest shear, dry mid, strong heating.
  if (
    cape >= 1500 &&
    shear < 0.35 &&
    dryPunch >= 0.45 &&
    diurnal >= 0.45 &&
    suppress >= 0.4
  ) {
    wind = Math.max(wind, 10 + dryPunch * 15);
  }

  // —— Heavy rainfall ——
  const train =
    clamp01(m.precipProb / 100) * 0.25 +
    clamp01(convectivePrecip / 20) * 0.3 +
    moisture * 0.2 +
    clamp01(cape / 1800) * 0.15 +
    // Slow/cell-regenerating: lower shear helps training in moist tropics.
    (tropical ? (1 - shear * 0.5) * 0.1 : (1 - shear) * 0.05);
  let rain = train * suppress * 85;
  if (m.cloudLow >= 60 && moisture >= 0.45) rain = Math.max(rain, rain * 1.1);
  if (convectivePrecip >= 8) rain = Math.max(rain, 25);
  if (m.precipProb >= 70 && moisture >= 0.4) rain = Math.max(rain, 18);
  if (cape < 100 && convectivePrecip < 2) rain = Math.min(rain, 5);

  // —— Tornado ——
  // Rare: needs organised storms + deep shear + low LCL + lift.
  // Kept deliberately low vs hail/wind so ordinary CAPE days stay near zero.
  const lowLcl = clamp01((12 - m.dewDepression) / 9);
  const torCore =
    clamp01(cape / 2600) * 0.18 +
    shear * 0.38 +
    moisture * 0.12 +
    lowLcl * 0.18 +
    synoptic * 0.1 +
    (risk.hatch >= 2 ? 0.1 : risk.hatch >= 1 ? 0.05 : 0);
  let tornado =
    torCore * suppress * (organised ? 0.85 : 0.25) * (risk.rank >= 5 ? 1 : 0.7) * 18;
  // Soft environments: essentially no tornado contour.
  if (risk.rank < 4 || cape < 1100 || shear < 0.4 || moisture < 0.3) {
    tornado *= 0.12;
  }
  if (risk.rank < 3 || cape < 900 || shear < 0.35) tornado = 0;
  // Hatch is a hint, not a free 10%+ floor.
  if (risk.hatch >= 2 && shear >= 0.45 && cape >= 1400) {
    tornado = Math.max(tornado, 5);
  } else if (risk.hatch >= 1 && shear >= 0.4 && cape >= 1200) {
    tornado = Math.max(tornado, 2);
  }
  if (m.peakCin <= -40 && synoptic < 0.5) tornado *= 0.3;
  if (tropical && shear < 0.5) tornado *= 0.2;
  if (subtrop && shear < 0.45) tornado *= 0.45;
  // Hard ceiling — AU tornado probs should almost never look “high”.
  tornado = Math.min(tornado, 18);

  return {
    tstorm: clampPct(tstorm),
    hail: clampPct(hail),
    wind: clampPct(wind),
    rain: clampPct(rain),
    tornado: clampPct(tornado),
  };
}

export function hazardPctForProduct(
  chances: HazardChances,
  product: ModelRiskProduct,
): number {
  switch (product) {
    case "tstorm":
      return chances.tstorm;
    case "hail":
      return chances.hail;
    case "wind":
      return chances.wind;
    case "rain":
      return chances.rain;
    case "tornado":
      return chances.tornado;
    default:
      return 0;
  }
}

export function hazardChanceToSampleRank(
  product: ModelRiskProduct,
  pct: number,
): number {
  if (product === "risk") return 0;
  return chancePctToRank(pct, chanceBandsFor(product));
}
