/**
 * SkyWatch model-risk products: categorical risk + hazard chance layers.
 * Chance bands are SPC-style probability contours (within ~40 km).
 */

import type { CategoryStyle, DisplayLegendItem } from "@/lib/forecast/types";

export type ModelRiskProduct =
  | "risk"
  | "tstorm"
  | "hail"
  | "wind"
  | "rain"
  | "tornado";

export const MODEL_RISK_PRODUCTS: ModelRiskProduct[] = [
  "risk",
  "tstorm",
  "hail",
  "wind",
  "rain",
  "tornado",
];

export type ChanceBand = {
  /** Rank 1…N used by the raster mesh. */
  rank: number;
  /** Probability threshold (%) for this contour. */
  pct: number;
  id: string;
  label: string;
  color: string;
  rgba: [number, number, number, number];
  /** Optional darker contour / swatch frame (nested key look). */
  strokeColor?: string;
  blurb: string;
};

export type ProductMeta = {
  id: ModelRiskProduct;
  label: string;
  shortLabel: string;
  /** Sidebar / empty-state title. */
  keyTitle: string;
  description: string;
  emptyMessage: (modelLabel: string) => string;
  /** Chance products use probability bands; risk uses the categorical ladder. */
  kind: "risk" | "chance";
  bands?: ChanceBand[];
};

function band(
  rank: number,
  pct: number,
  color: string,
  rgba: [number, number, number, number],
  blurb: string,
  strokeColor?: string,
): ChanceBand {
  return {
    rank,
    pct,
    id: `p${pct}`,
    label: `${pct}%`,
    color,
    rgba,
    strokeColor,
    blurb,
  };
}

/**
 * General thunderstorm chance (broader, higher probabilities).
 * Beige → gold nested scale (fill / darker frame).
 */
export const TSTORM_CHANCE_BANDS: ChanceBand[] = [
  band(
    1,
    15,
    "#D9CDAF",
    [217, 205, 175, 190],
    "15% chance of a thunderstorm.",
    "#C4BA9F",
  ),
  band(
    2,
    30,
    "#DFCA93",
    [223, 202, 147, 195],
    "30% chance of a thunderstorm.",
    "#CAB787",
  ),
  band(
    3,
    45,
    "#DDBD67",
    [221, 189, 103, 200],
    "45% chance of a thunderstorm.",
    "#BCA15A",
  ),
  band(
    4,
    60,
    "#ECBE43",
    [236, 190, 67, 205],
    "60% chance of a thunderstorm.",
    "#C09B38",
  ),
  band(
    5,
    75,
    "#DBA71C",
    [219, 167, 28, 210],
    "75%+ chance of a thunderstorm.",
    "#A37B10",
  ),
];

/** Large hail (≥ ~2 cm) chance. */
export const HAIL_CHANCE_BANDS: ChanceBand[] = [
  band(1, 5, "#7E9AAF", [126, 154, 175, 165], "5% chance of large hail."),
  band(2, 15, "#5B8FA8", [91, 143, 168, 170], "15% chance of large hail."),
  band(3, 30, "#3D7CA3", [61, 124, 163, 180], "30% chance of large hail."),
  band(4, 45, "#8E44AD", [142, 68, 173, 185], "45% chance of large hail."),
  band(5, 60, "#6C3483", [108, 52, 131, 195], "60%+ chance of large hail."),
];

/**
 * Damaging wind chance — brown → beige → rose → pink → magenta scale.
 */
export const WIND_CHANCE_BANDS: ChanceBand[] = [
  band(
    1,
    5,
    "#846C5E",
    [132, 108, 94, 190],
    "5% chance of damaging winds.",
    "#6E584C",
  ),
  band(
    2,
    15,
    "#C6B476",
    [198, 180, 118, 195],
    "15% chance of damaging winds.",
    "#A8945E",
  ),
  band(
    3,
    30,
    "#BD6568",
    [189, 101, 104, 200],
    "30% chance of damaging winds.",
    "#9A4F52",
  ),
  band(
    4,
    45,
    "#C75B81",
    [199, 91, 129, 205],
    "45% chance of damaging winds.",
    "#A34868",
  ),
  band(
    5,
    60,
    "#C44596",
    [196, 69, 150, 210],
    "60%+ chance of damaging winds.",
    "#9E3578",
  ),
];

/** Heavy rainfall / flash-flooding rain chance. */
export const RAIN_CHANCE_BANDS: ChanceBand[] = [
  band(1, 10, "#5DADE2", [93, 173, 226, 165], "10% chance of heavy rainfall."),
  band(2, 20, "#3498DB", [52, 152, 219, 170], "20% chance of heavy rainfall."),
  band(3, 40, "#2E86C1", [46, 134, 193, 180], "40% chance of heavy rainfall."),
  band(4, 60, "#1A5276", [26, 82, 118, 185], "60% chance of heavy rainfall."),
  band(5, 80, "#154360", [21, 67, 96, 195], "80%+ chance of heavy rainfall."),
];

/**
 * Tornado chance (rare — tighter, lower probabilities).
 * Green → yellow → orange → red scale. Top band is 15%+ — scoring
 * hard-ceilings near 18%, so a 30% swatch never appeared on the map.
 */
export const TORNADO_CHANCE_BANDS: ChanceBand[] = [
  band(
    1,
    2,
    "#48C65A",
    [72, 198, 90, 190],
    "2% chance of a tornado.",
    "#309642",
  ),
  band(
    2,
    5,
    "#FCFC72",
    [252, 252, 114, 195],
    "5% chance of a tornado.",
    "#D2D254",
  ),
  band(
    3,
    10,
    "#FCC660",
    [252, 198, 96, 200],
    "10% chance of a tornado.",
    "#D2A84E",
  ),
  band(
    4,
    15,
    "#F06066",
    [240, 96, 102, 210],
    "15%+ chance of a tornado.",
    "#C64E54",
  ),
];

export const PRODUCT_META: Record<ModelRiskProduct, ProductMeta> = {
  risk: {
    id: "risk",
    label: "Risk",
    shortLabel: "Risk",
    keyTitle: "Convective risk",
    description:
      "Categorical thunderstorm risk ladder (ingredients + suppressors).",
    emptyMessage: (model) =>
      `No elevated thunderstorm risk in SkyWatch ${model} guidance.`,
    kind: "risk",
  },
  tstorm: {
    id: "tstorm",
    label: "Thunderstorm chance",
    shortLabel: "T-Storm",
    keyTitle: "Thunderstorm chance",
    description: "Probability of a thunderstorm within ~40 km.",
    emptyMessage: (model) =>
      `No elevated thunderstorm chance in SkyWatch ${model} guidance.`,
    kind: "chance",
    bands: TSTORM_CHANCE_BANDS,
  },
  hail: {
    id: "hail",
    label: "Large hail chance",
    shortLabel: "Hail",
    keyTitle: "Large hail chance",
    description: "Probability of large hail (about 2 cm+).",
    emptyMessage: (model) =>
      `No elevated large-hail chance in SkyWatch ${model} guidance.`,
    kind: "chance",
    bands: HAIL_CHANCE_BANDS,
  },
  wind: {
    id: "wind",
    label: "Damaging winds chance",
    shortLabel: "Wind",
    keyTitle: "Damaging winds chance",
    description: "Probability of damaging thunderstorm winds / gusts.",
    emptyMessage: (model) =>
      `No elevated damaging-wind chance in SkyWatch ${model} guidance.`,
    kind: "chance",
    bands: WIND_CHANCE_BANDS,
  },
  rain: {
    id: "rain",
    label: "Heavy rainfall chance",
    shortLabel: "Rain",
    keyTitle: "Heavy rainfall chance",
    description: "Probability of heavy convective rainfall.",
    emptyMessage: (model) =>
      `No elevated heavy-rainfall chance in SkyWatch ${model} guidance.`,
    kind: "chance",
    bands: RAIN_CHANCE_BANDS,
  },
  tornado: {
    id: "tornado",
    label: "Tornado chance",
    shortLabel: "Tornado",
    keyTitle: "Tornado chance",
    description: "Probability of a tornado (rare; guidance only).",
    emptyMessage: (model) =>
      `No elevated tornado chance in SkyWatch ${model} guidance.`,
    kind: "chance",
    bands: TORNADO_CHANCE_BANDS,
  },
};

export function resolveModelRiskProduct(
  raw: string | null | undefined,
): ModelRiskProduct {
  const s = (raw || "risk").trim().toLowerCase();
  if (s === "tstorm" || s === "thunder" || s === "thunderstorm") return "tstorm";
  if (s === "hail" || s === "large_hail" || s === "large-hail") return "hail";
  if (s === "wind" || s === "winds" || s === "damaging_wind") return "wind";
  if (s === "rain" || s === "rainfall" || s === "heavy_rain") return "rain";
  if (s === "tornado" || s === "tor") return "tornado";
  return "risk";
}

export function chanceBandsFor(product: ModelRiskProduct): ChanceBand[] {
  return PRODUCT_META[product].bands ?? [];
}

export function chancePctToRank(
  pct: number,
  bands: ChanceBand[],
): number {
  let rank = 0;
  for (const b of bands) {
    if (pct >= b.pct) rank = b.rank;
  }
  return rank;
}

export function chanceColorMap(
  bands: ChanceBand[],
): Record<number, [number, number, number, number]> {
  const out: Record<number, [number, number, number, number]> = {};
  for (const b of bands) out[b.rank] = b.rgba;
  return out;
}

function styleForBand(b: ChanceBand): CategoryStyle {
  return {
    fillColor: b.color,
    fillOpacity: 0.78,
    strokeColor: b.strokeColor ?? b.color,
    strokeOpacity: 0.95,
    strokeWidth: 1.5,
    hatch: "none",
  };
}

export function chanceLegendItems(
  product: ModelRiskProduct,
  options?: { usedRanks?: Set<number> },
): DisplayLegendItem[] {
  const bands = chanceBandsFor(product);
  const used = options?.usedRanks;
  return bands.map((b) => ({
    id: b.id,
    label: b.label,
    order: b.rank,
    style: styleForBand(b),
    used: used == null ? true : used.has(b.rank),
  }));
}

export function chanceBlurbs(
  product: ModelRiskProduct,
): { id: string; blurb: string }[] {
  return chanceBandsFor(product).map((b) => ({ id: b.id, blurb: b.blurb }));
}
