/**
 * SkyWatch automated convective risk categories + legend copy.
 * L1/L2 are SPC-style hatch overlays, not standalone fills.
 */

import type { CategoryStyle, DisplayLegendItem } from "@/lib/forecast/types";

export type AutoRiskCategoryId =
  | "low_tstorm"
  | "tstorm"
  | "low"
  | "slight"
  | "severe"
  | "moderate"
  | "high"
  | "vhigh";

export type AutoHatchId = "none" | "l1" | "l2";

export type AutoRiskCategory = {
  id: AutoRiskCategoryId;
  label: string;
  /** Soft-field rank 1…8 (0 = no risk). */
  rank: number;
  color: string;
  /** RGBA for PNG fill. */
  rgba: [number, number, number, number];
  blurb: string;
};

export const AUTO_RISK_CATEGORIES: AutoRiskCategory[] = [
  {
    id: "low_tstorm",
    label: "Low T-Storm",
    rank: 1,
    color: "#3A3A3A",
    rgba: [58, 58, 58, 165],
    blurb: "Below 10% chance of a thunderstorm.",
  },
  {
    id: "tstorm",
    label: "T-Storm",
    rank: 2,
    color: "#A8B89A",
    rgba: [168, 184, 154, 170],
    blurb:
      "25% storms · 10% organised convection · 2% severe hazards.",
  },
  {
    id: "low",
    label: "Low",
    rank: 3,
    color: "#9CCC65",
    rgba: [156, 204, 101, 175],
    blurb:
      "30% storms · 7% organised convection · 1% severe hazards.",
  },
  {
    id: "slight",
    label: "Slight",
    rank: 4,
    color: "#FFEB3B",
    rgba: [255, 235, 59, 180],
    blurb:
      "40% storms · 20% organised convection · 5% severe hazards.",
  },
  {
    id: "severe",
    label: "Severe",
    rank: 5,
    color: "#FF9800",
    rgba: [255, 152, 0, 185],
    blurb:
      "50% storms · 30% organised · 15% severe · 2% very dangerous.",
  },
  {
    id: "moderate",
    label: "Moderate",
    rank: 6,
    color: "#F44336",
    rgba: [244, 67, 54, 190],
    blurb:
      "60% storms · 40% organised · 25% severe · 7% very dangerous.",
  },
  {
    id: "high",
    label: "High",
    rank: 7,
    color: "#E91E63",
    rgba: [233, 30, 99, 195],
    blurb:
      "70% storms · 50% organised · 40% severe · 12% very dangerous.",
  },
  {
    id: "vhigh",
    label: "V-High",
    rank: 8,
    color: "#9C27B0",
    rgba: [156, 39, 176, 200],
    blurb:
      "75% storms · 60% organised · 50% severe · 5% very dangerous.",
  },
];

export const AUTO_HATCH_LEGEND = [
  {
    id: "l1_hatched",
    label: "L1 Hatched",
    hatch: "diagonal" as const,
    fillColor: "#9E9E9E",
    blurb:
      "Interesting for supercells — wall clouds, shelf structure, weak tornadoes possible.",
  },
  {
    id: "l2_hatched",
    label: "L2 Hatched",
    hatch: "crosshatch" as const,
    fillColor: "#212121",
    blurb:
      "Favourable for moderate–strong tornadoes and long-lived destructive supercells.",
  },
] as const;

export const AUTO_RISK_MAX_RANK = 8;
export const AUTO_RISK_DAY_COUNT = 7;

export function categoryByRank(rank: number): AutoRiskCategory | null {
  if (rank < 1 || rank > AUTO_RISK_MAX_RANK) return null;
  return AUTO_RISK_CATEGORIES[rank - 1] ?? null;
}

export function styleForCategory(cat: AutoRiskCategory): CategoryStyle {
  return {
    fillColor: cat.color,
    fillOpacity: 0.72,
    strokeColor: cat.color,
    strokeOpacity: 0.95,
    strokeWidth: 1.5,
    hatch: "none",
  };
}

/** Full legend including hatch overlays for the Automated risk sidebar. */
export function autoRiskLegendItems(options?: {
  usedRanks?: Set<number>;
  usedHatches?: Set<AutoHatchId>;
}): DisplayLegendItem[] {
  const usedRanks = options?.usedRanks;
  const usedHatches = options?.usedHatches;
  const cats: DisplayLegendItem[] = AUTO_RISK_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    order: c.rank,
    style: styleForCategory(c),
    used: usedRanks == null ? true : usedRanks.has(c.rank),
  }));
  const hatches: DisplayLegendItem[] = AUTO_HATCH_LEGEND.map((h, i) => ({
    id: h.id,
    label: h.label,
    order: 100 + i,
    style: {
      fillColor: h.fillColor,
      fillOpacity: 1,
      strokeColor: "#111111",
      strokeOpacity: 0.9,
      strokeWidth: 1,
      hatch: h.hatch,
    },
    used:
      usedHatches == null
        ? true
        : usedHatches.has(h.id === "l1_hatched" ? "l1" : "l2"),
  }));
  return [...cats, ...hatches];
}

export function autoRiskCategoryBlurbs(): { id: string; blurb: string }[] {
  return [
    ...AUTO_RISK_CATEGORIES.map((c) => ({ id: c.id, blurb: c.blurb })),
    ...AUTO_HATCH_LEGEND.map((h) => ({ id: h.id, blurb: h.blurb })),
  ];
}
