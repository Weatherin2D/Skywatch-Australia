import type { CategoryStyle } from "@/lib/forecast/types";
import type { MapRegionId, RegionBounds } from "@/components/home/mock-data";
import { getMapRegion } from "@/components/home/mock-data";

/**
 * BoM categorical thunderstorm forecast key (public product legend).
 * Thunderstorms possible = green
 * Thunderstorms likely = pale/light green
 * Severe thunderstorms possible = yellow
 * Severe thunderstorms likely = red
 */
export const BOM_THUNDERSTORM_CATEGORIES = [
  {
    id: "tstm_possible",
    label: "Thunderstorms Possible",
    color: "#2E7D32",
  },
  {
    id: "tstm_likely",
    label: "Thunderstorms Likely",
    color: "#AED581",
  },
  {
    id: "severe_possible",
    label: "Severe Thunderstorms Possible",
    color: "#F9A825",
  },
  {
    id: "severe_likely",
    label: "Severe Thunderstorms Likely",
    color: "#C62828",
  },
] as const;

export type BomRiskCategoryId =
  (typeof BOM_THUNDERSTORM_CATEGORIES)[number]["id"];

const STYLE_BY_ID: Record<BomRiskCategoryId, CategoryStyle> = {
  tstm_possible: {
    fillColor: "#2E7D32",
    fillOpacity: 0.55,
    strokeColor: "#1B5E20",
    strokeOpacity: 0.95,
    strokeWidth: 1.5,
    hatch: "none",
  },
  tstm_likely: {
    fillColor: "#AED581",
    fillOpacity: 0.6,
    strokeColor: "#7CB342",
    strokeOpacity: 0.95,
    strokeWidth: 1.5,
    hatch: "none",
  },
  severe_possible: {
    fillColor: "#F9A825",
    fillOpacity: 0.62,
    strokeColor: "#F57F17",
    strokeOpacity: 0.95,
    strokeWidth: 1.75,
    hatch: "none",
  },
  severe_likely: {
    fillColor: "#C62828",
    fillOpacity: 0.65,
    strokeColor: "#8E0000",
    strokeOpacity: 1,
    strokeWidth: 2,
    hatch: "none",
  },
};

/** Map free-text / AusRisk / SPC-ish labels onto the BoM 4-level key. */
export function classifyBomRiskLabel(label: string): BomRiskCategoryId | null {
  const l = label.trim().toLowerCase();
  if (!l || l === "placeholder") return null;

  // Hatched significant overlays → treat as severe likely base.
  if (/\bl1\b|\bl2\b|hatched/.test(l)) return "severe_likely";

  if (
    /severe/.test(l) &&
    (/likely/.test(l) ||
      /\bmoderate\b/.test(l) ||
      /\bhigh\b/.test(l) ||
      /\bv-?high\b/.test(l) ||
      /\bmdt\b/.test(l))
  ) {
    return "severe_likely";
  }

  if (
    /severe/.test(l) ||
    /\bslight\b/.test(l) ||
    /\benh\b/.test(l) ||
    /\bslgt\b/.test(l)
  ) {
    return "severe_possible";
  }

  // Bare AusRisk "Moderate/High/V-High" without the word severe.
  if (/\bmoderate\b|\bhigh\b|\bv-?high\b/.test(l)) return "severe_likely";

  if (
    (/likely/.test(l) && !/severe/.test(l)) ||
    /^t-?storms?$/.test(l) ||
    /\bmrgl\b/.test(l)
  ) {
    return "tstm_likely";
  }

  if (
    /possible/.test(l) ||
    /low\s*t-?storm/.test(l) ||
    /\btstm\b/.test(l) ||
    /^low$/.test(l)
  ) {
    return "tstm_possible";
  }

  return null;
}

export function styleForBomRiskLabel(label: string): CategoryStyle | null {
  const id = classifyBomRiskLabel(label);
  if (!id) return null;
  const base = STYLE_BY_ID[id];
  // Preserve hatch intent from original label when present.
  if (/\bl2\b|crosshatch/.test(label.toLowerCase())) {
    return { ...base, hatch: "crosshatch", fillOpacity: 0.35 };
  }
  if (/\bl1\b|diagonal|hatched/.test(label.toLowerCase())) {
    return { ...base, hatch: "diagonal", fillOpacity: 0.35 };
  }
  return { ...base };
}

export function bomLegendItems() {
  return BOM_THUNDERSTORM_CATEGORIES.map((c, order) => ({
    id: c.id,
    label: c.label,
    order,
    style: STYLE_BY_ID[c.id],
    used: true as boolean,
  }));
}

/** Optional BoM product-sheet image uploads (not used for the public polygon map). */
export type BomThunderstormDay = 1 | 2 | 3;
export type BomRiskDisplay = "sheet" | "geo";

export type BomRiskDayRecord = {
  day: BomThunderstormDay;
  issuedAt: string | null;
  regionId: MapRegionId;
  display: BomRiskDisplay;
  imagePath: string | null;
  contentType: string | null;
  fileName: string | null;
};

export type BomRiskManifest = {
  updatedAt: string;
  days: Record<"1" | "2" | "3", BomRiskDayRecord>;
};

export type BomRiskDayPublic = {
  day: BomThunderstormDay;
  label: string;
  dateLabel: string;
  available: boolean;
  issuedAt: string | null;
  regionId: MapRegionId;
  display: BomRiskDisplay;
  imageUrl: string | null;
  imageBounds: RegionBounds;
};

export function emptyBomRiskManifest(now = new Date()): BomRiskManifest {
  const base = (day: BomThunderstormDay): BomRiskDayRecord => ({
    day,
    issuedAt: null,
    regionId: "national",
    display: "sheet",
    imagePath: null,
    contentType: null,
    fileName: null,
  });
  return {
    updatedAt: now.toISOString(),
    days: { "1": base(1), "2": base(2), "3": base(3) },
  };
}

export function bomRiskDayLabels(now = new Date()): Record<
  BomThunderstormDay,
  { label: string; dateLabel: string }
> {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = ymd.split("-").map(Number);
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const out = {} as Record<
    BomThunderstormDay,
    { label: string; dateLabel: string }
  >;
  for (const day of [1, 2, 3] as const) {
    const noon = new Date(Date.UTC(y!, m! - 1, d! + (day - 1), 12));
    out[day] = {
      label: day === 1 ? "Day 1 · Today" : `Day ${day}`,
      dateLabel: fmt.format(noon),
    };
  }
  return out;
}

export function boundsForRiskRegion(regionId: MapRegionId): RegionBounds {
  return getMapRegion(regionId).bounds;
}

export function isBomThunderstormDay(n: number): n is BomThunderstormDay {
  return n === 1 || n === 2 || n === 3;
}
