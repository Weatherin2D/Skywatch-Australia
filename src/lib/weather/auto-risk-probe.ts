/**
 * Point-probe helpers for SkyWatch risk products — nearest sample site
 * ingredients + human-readable "why this rating" copy.
 */

import {
  AUTO_HATCH_LEGEND,
  AUTO_RISK_CATEGORIES,
  categoryByRank,
} from "@/lib/weather/auto-risk-categories";
import type { HazardChances } from "@/lib/weather/auto-risk-hazards";
import {
  PRODUCT_META,
  chanceBandsFor,
  chancePctToRank,
  type ModelRiskProduct,
} from "@/lib/weather/auto-risk-products";

export type AutoRiskProbeSite = {
  lat: number;
  lon: number;
  rank: number;
  hatch: 0 | 1 | 2;
  composite: number;
  suppress: number;
  chances: HazardChances;
  cape: number;
  shearKts: number;
  dewpoint: number;
  liftedIndex: number;
  cin: number;
  precipProb: number;
  diurnalHeating: number;
  precipMm: number;
  showersMm: number;
  freezingLevelM: number;
  peakWindKmh: number;
  dewDepression: number;
  weatherCode: number;
  liftTrigger: number;
};

export type RiskProbeResult = {
  status: "ok" | "empty";
  source: string;
  product: ModelRiskProduct | "bom";
  day: number;
  lat: number;
  lon: number;
  distanceKm: number;
  category: {
    id: string;
    label: string;
    color: string;
    rank: number;
    hatch: 0 | 1 | 2;
    hatchLabel: string | null;
  };
  summary: string;
  reasons: string[];
  conditions: Array<{ label: string; value: string; hint?: string }>;
  hazards?: Array<{ id: string; label: string; pct: number }>;
  guidance: string;
};

function approxKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat1 - lat2) * 111.0;
  const dLon =
    (lon1 - lon2) * 111.0 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

export function nearestProbeSite(
  sites: AutoRiskProbeSite[],
  lat: number,
  lon: number,
): { site: AutoRiskProbeSite; distanceKm: number } | null {
  if (!sites.length) return null;
  let best = sites[0]!;
  let bestD = approxKm(lat, lon, best.lat, best.lon);
  for (let i = 1; i < sites.length; i++) {
    const s = sites[i]!;
    const d = approxKm(lat, lon, s.lat, s.lon);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return { site: best, distanceKm: bestD };
}

function hatchLabel(hatch: 0 | 1 | 2): string | null {
  if (hatch === 1) return AUTO_HATCH_LEGEND[0]!.label;
  if (hatch === 2) return AUTO_HATCH_LEGEND[1]!.label;
  return null;
}

function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function buildReasons(
  site: AutoRiskProbeSite,
  product: ModelRiskProduct,
): string[] {
  const reasons: string[] = [];
  const tropical = site.lat >= -23.5;
  const organised =
    site.shearKts >= 0.35 * 65 ||
    site.liftTrigger >= 0.4 ||
    site.weatherCode >= 95;

  if (product === "risk") {
    if (site.rank <= 0) {
      reasons.push(
        "Ingredients are too weak or suppressed for an elevated thunderstorm risk contour here.",
      );
    } else {
      const cat = categoryByRank(site.rank);
      reasons.push(
        `Rated ${cat?.label ?? `rank ${site.rank}`} from a composite score of ${fmt(site.composite * 100, 0)}/100 after suppression (${fmt(site.suppress * 100, 0)}% of full signal kept).`,
      );
    }
    if (site.cape >= 1300) {
      reasons.push(
        `Strong instability — CAPE around ${fmt(site.cape, 0)} J/kg supports taller updrafts.`,
      );
    } else if (site.cape >= 400) {
      reasons.push(
        `Modest CAPE (${fmt(site.cape, 0)} J/kg) can still support ordinary cells if moisture and lift align.`,
      );
    } else if (site.cape > 0) {
      reasons.push(
        `CAPE is only ${fmt(site.cape, 0)} J/kg — limited buoyant energy for deep convection.`,
      );
    }
    if (site.shearKts >= 35) {
      reasons.push(
        `Deep-layer shear ~${fmt(site.shearKts, 0)} kt favours organised storms / supercell structures.`,
      );
    } else if (site.shearKts >= 20) {
      reasons.push(
        `Shear ~${fmt(site.shearKts, 0)} kt — some organisation possible, not a classic supercell setup.`,
      );
    } else if (site.rank >= 3) {
      reasons.push(
        `Low shear (~${fmt(site.shearKts, 0)} kt) points to pulse / multicell storms rather than long-lived supercells.`,
      );
    }
    if (site.dewpoint >= 16) {
      reasons.push(
        `Moist boundary layer (dewpoint ~${fmt(site.dewpoint, 1)}°C) helps storm inflow.`,
      );
    } else if (site.dewpoint < 10 && site.rank > 0) {
      reasons.push(
        `Drier air (dewpoint ~${fmt(site.dewpoint, 1)}°C) limits storm coverage even with some CAPE.`,
      );
    }
    if (site.liftedIndex <= -2) {
      reasons.push(
        `Lifted Index ${fmt(site.liftedIndex, 1)}°C — the column is clearly unstable.`,
      );
    } else if (site.liftedIndex >= 4 && !tropical) {
      reasons.push(
        `Lifted Index ${fmt(site.liftedIndex, 1)}°C is stable — storms need a strong local trigger.`,
      );
    }
    if (site.cin <= -70) {
      reasons.push(
        `A stout CIN cap (~${fmt(site.cin, 0)} J/kg) is holding convection back unless lift breaks it.`,
      );
    }
    if (site.diurnalHeating >= 0.45 && site.rank > 0) {
      reasons.push(
        "Daytime heating is a meaningful trigger — afternoon pulse cells are favoured.",
      );
    }
    if (site.liftTrigger >= 0.4) {
      reasons.push(
        "A synoptic / boundary lift signal is present near this point (front, dryline, or convergence).",
      );
    }
    if (tropical && site.rank > 0 && site.rank <= 3 && !organised) {
      reasons.push(
        "Tropical / subtropical pulse environments are capped at Low so lone CAPE spikes do not paint Severe.",
      );
    }
    if (site.hatch === 2) {
      reasons.push(AUTO_HATCH_LEGEND[1]!.blurb);
    } else if (site.hatch === 1) {
      reasons.push(AUTO_HATCH_LEGEND[0]!.blurb);
    }
    if (site.suppress < 0.35 && site.rank > 0) {
      reasons.push(
        "Storm suppressors (dry air, morning cloud, capping, or rising pressure) are trimming the rating.",
      );
    }
    return reasons.slice(0, 6);
  }

  // Chance products
  const pct = site.chances[product as keyof HazardChances] ?? 0;
  const bands = chanceBandsFor(product);
  const bandRank = chancePctToRank(pct, bands);
  const band = bands.find((b) => b.rank === bandRank);
  if (bandRank <= 0) {
    reasons.push(
      `No elevated ${PRODUCT_META[product].shortLabel.toLowerCase()} contour at this point (model chance ~${fmt(pct, 0)}%).`,
    );
  } else {
    reasons.push(
      `${PRODUCT_META[product].label} ~${fmt(pct, 0)}% within ~40 km → ${band?.label ?? `${bandRank}`} band.`,
    );
  }
  if (product === "tstorm") {
    if (site.cape >= 400) {
      reasons.push(`CAPE ${fmt(site.cape, 0)} J/kg supports thunderstorm updrafts.`);
    }
    if (site.precipProb >= 40) {
      reasons.push(`Model precip probability peaks near ${fmt(site.precipProb, 0)}%.`);
    }
  }
  if (product === "hail") {
    reasons.push(
      site.freezingLevelM > 0
        ? `Freezing level ~${fmt(site.freezingLevelM, 0)} m — ${site.freezingLevelM <= 3800 ? "hail-friendly" : "somewhat high for large hail"}.`
        : "Freezing level unavailable for this model sample.",
    );
    if (site.shearKts >= 30 && site.cape >= 1200) {
      reasons.push("CAPE + shear pairing supports hail growth in organised cells.");
    }
  }
  if (product === "wind") {
    reasons.push(
      `Peak gust proxy ~${fmt(site.peakWindKmh, 0)} km/h with shear ~${fmt(site.shearKts, 0)} kt.`,
    );
  }
  if (product === "rain") {
    reasons.push(
      `Convective rain/showers ~${fmt(Math.max(site.showersMm, site.precipMm), 1)} mm with moisture (dewpoint ${fmt(site.dewpoint, 1)}°C).`,
    );
  }
  if (product === "tornado") {
    reasons.push(
      "Tornado chances stay deliberately low in AU guidance — need organised storms, deep shear, and a low LCL.",
    );
    if (site.hatch >= 1) {
      reasons.push("A supercell hatch nearby is the main tornado hint on this outlook.");
    }
  }
  return reasons.slice(0, 6);
}

function buildConditions(
  site: AutoRiskProbeSite,
  product: ModelRiskProduct,
): RiskProbeResult["conditions"] {
  const rows: RiskProbeResult["conditions"] = [
    {
      label: "CAPE",
      value: `${fmt(site.cape, 0)} J/kg`,
      hint: "Instability / updraft fuel",
    },
    {
      label: "Shear",
      value: `${fmt(site.shearKts, 0)} kt`,
      hint: "Deep-layer organisation",
    },
    {
      label: "Dewpoint",
      value: `${fmt(site.dewpoint, 1)}°C`,
      hint: "Low-level moisture",
    },
    {
      label: "Lifted Index",
      value: `${fmt(site.liftedIndex, 1)}°C`,
      hint: "More negative = more unstable",
    },
    {
      label: "CIN",
      value: `${fmt(site.cin, 0)} J/kg`,
      hint: "Cap strength (more negative = harder to break)",
    },
    {
      label: "Precip chance",
      value: `${fmt(site.precipProb, 0)}%`,
    },
    {
      label: "Daytime heating",
      value: `${fmt(site.diurnalHeating * 100, 0)}%`,
      hint: "Pulse-storm trigger potential",
    },
  ];
  if (product === "hail" || product === "risk") {
    rows.push({
      label: "Freezing level",
      value:
        site.freezingLevelM > 0 ? `${fmt(site.freezingLevelM, 0)} m` : "—",
    });
  }
  if (product === "wind" || product === "risk") {
    rows.push({
      label: "Peak gust",
      value: `${fmt(site.peakWindKmh, 0)} km/h`,
    });
  }
  return rows;
}

export function explainProbeSite(
  site: AutoRiskProbeSite,
  product: ModelRiskProduct,
  opts: {
    source: string;
    day: number;
    lat: number;
    lon: number;
    distanceKm: number;
  },
): RiskProbeResult {
  const reasons = buildReasons(site, product);
  let category: RiskProbeResult["category"];
  let summary: string;

  if (product === "risk") {
    const cat = categoryByRank(site.rank);
    const hLabel = hatchLabel(site.hatch);
    category = {
      id: cat?.id ?? "none",
      label: cat?.label ?? "No elevated risk",
      color: cat?.color ?? "#3A3A3A",
      rank: site.rank,
      hatch: site.hatch,
      hatchLabel: hLabel,
    };
    summary =
      site.rank <= 0
        ? "No elevated convective risk contour at this point for the selected day."
        : `${cat!.label}${hLabel ? ` · ${hLabel}` : ""} — ${cat!.blurb}`;
  } else {
    const pct = site.chances[product as keyof HazardChances] ?? 0;
    const bands = chanceBandsFor(product);
    const bandRank = chancePctToRank(pct, bands);
    const band = bands.find((b) => b.rank === bandRank);
    category = {
      id: band?.id ?? "none",
      label:
        bandRank > 0
          ? `${PRODUCT_META[product].shortLabel} ${band?.label}`
          : "No elevated chance",
      color: band?.color ?? "#3A3A3A",
      rank: bandRank,
      hatch: 0,
      hatchLabel: null,
    };
    summary =
      bandRank > 0
        ? `${PRODUCT_META[product].label} about ${fmt(pct, 0)}% within ~40 km (${band?.label} band).`
        : `No elevated ${PRODUCT_META[product].shortLabel.toLowerCase()} contour here (~${fmt(pct, 0)}%).`;
  }

  return {
    status: site.rank > 0 || (product !== "risk" && category.rank > 0) ? "ok" : "empty",
    source: opts.source,
    product,
    day: opts.day,
    lat: opts.lat,
    lon: opts.lon,
    distanceKm: opts.distanceKm,
    category,
    summary,
    reasons,
    conditions: buildConditions(site, product),
    hazards: [
      { id: "tstorm", label: "Thunderstorm", pct: site.chances.tstorm },
      { id: "hail", label: "Large hail", pct: site.chances.hail },
      { id: "wind", label: "Damaging wind", pct: site.chances.wind },
      { id: "rain", label: "Heavy rain", pct: site.chances.rain },
      { id: "tornado", label: "Tornado", pct: site.chances.tornado },
    ],
    guidance:
      "Guidance from the nearest model sample (~40 km scale). Not an official warning — check BoM for warnings.",
  };
}

/** Category definition card when a legend swatch is tapped. */
export function explainCategoryDefinition(
  product: ModelRiskProduct,
  categoryId: string,
): {
  id: string;
  label: string;
  color: string;
  blurb: string;
  productLabel: string;
} | null {
  if (product === "risk") {
    const cat = AUTO_RISK_CATEGORIES.find((c) => c.id === categoryId);
    if (cat) {
      return {
        id: cat.id,
        label: cat.label,
        color: cat.color,
        blurb: cat.blurb,
        productLabel: PRODUCT_META.risk.label,
      };
    }
    const hatch = AUTO_HATCH_LEGEND.find((h) => h.id === categoryId);
    if (hatch) {
      return {
        id: hatch.id,
        label: hatch.label,
        color: hatch.fillColor,
        blurb: hatch.blurb,
        productLabel: PRODUCT_META.risk.label,
      };
    }
    return null;
  }
  const band = chanceBandsFor(product).find((b) => b.id === categoryId);
  if (!band) return null;
  return {
    id: band.id,
    label: band.label,
    color: band.color,
    blurb: band.blurb,
    productLabel: PRODUCT_META[product].label,
  };
}
