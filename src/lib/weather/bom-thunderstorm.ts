import {
  getMapRegion,
  type MapRegionId,
  type RegionBounds,
} from "@/components/home/mock-data";

/** BoM categorical thunderstorm forecast levels (public product legend). */
export const BOM_THUNDERSTORM_CATEGORIES = [
  {
    id: "tstm_possible",
    label: "Thunderstorms Possible",
    color: "#7CB342",
  },
  {
    id: "tstm_likely",
    label: "Thunderstorms Likely",
    color: "#F9A825",
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

export type BomThunderstormDay = 1 | 2 | 3;

export type BomRiskDisplay = "sheet" | "geo";

export type BomRiskDayRecord = {
  day: BomThunderstormDay;
  /** ISO timestamp when this chart was issued / uploaded. */
  issuedAt: string | null;
  regionId: MapRegionId;
  /** sheet = full BoM product graphic; geo = plate georeferenced to region bounds */
  display: BomRiskDisplay;
  /** Relative API path or absolute URL for the chart image. */
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
  const issued = null;
  const base = (day: BomThunderstormDay): BomRiskDayRecord => ({
    day,
    issuedAt: issued,
    regionId: "national",
    display: "sheet",
    imagePath: null,
    contentType: null,
    fileName: null,
  });
  return {
    updatedAt: now.toISOString(),
    days: {
      "1": base(1),
      "2": base(2),
      "3": base(3),
    },
  };
}

/** Calendar labels in Australia/Sydney for Day 1 (today) … Day 3. */
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
