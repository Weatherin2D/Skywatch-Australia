/**
 * Smooth BoM-style risk regions — overlapping influence circles per level
 * (reads like the official outlook chart, not a town square grid).
 */

import type { DisplayFeature, GeoJsonGeometry } from "@/lib/forecast/types";
import type { BomRiskCategoryId } from "@/lib/weather/bom-thunderstorm";

const ID_BY_RANK: Record<number, BomRiskCategoryId> = {
  1: "tstm_possible",
  2: "tstm_likely",
  3: "severe_possible",
  4: "severe_likely",
};

/** Influence radius (km) per minimum risk level — outer bands are wider. */
const RADIUS_KM_BY_RANK: Record<number, number> = {
  1: 320,
  2: 260,
  3: 210,
  4: 175,
};

const CIRCLE_STEPS = 40;

export type RiskSamplePoint = {
  lat: number;
  lon: number;
  rank: number;
};

function destinationPoint(
  latDeg: number,
  lonDeg: number,
  distanceKm: number,
  bearingRad: number,
): [number, number] {
  const R = 6371;
  const lat1 = (latDeg * Math.PI) / 180;
  const lon1 = (lonDeg * Math.PI) / 180;
  const d = distanceKm / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function circleRing(
  lat: number,
  lon: number,
  radiusKm: number,
): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    const bearing = (2 * Math.PI * i) / CIRCLE_STEPS;
    ring.push(destinationPoint(lat, lon, radiusKm, bearing));
  }
  return smoothRing(ring);
}

function smoothRing(ring: number[][]): number[][] {
  if (ring.length < 4) return ring;
  const next: number[][] = [];
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const p0 = ring[i]!;
    const p1 = ring[i + 1]!;
    next.push([
      0.82 * p0[0]! + 0.18 * p1[0]!,
      0.82 * p0[1]! + 0.18 * p1[1]!,
    ]);
    next.push([
      0.18 * p0[0]! + 0.82 * p1[0]!,
      0.18 * p0[1]! + 0.82 * p1[1]!,
    ]);
  }
  next.push([next[0]![0]!, next[0]![1]!]);
  return next;
}

function ringsToGeometry(rings: number[][][]): GeoJsonGeometry | null {
  if (!rings.length) return null;
  if (rings.length === 1) {
    return { type: "Polygon", coordinates: [rings[0]!] };
  }
  return {
    type: "MultiPolygon",
    coordinates: rings.map((r) => [r]),
  };
}

export function buildSmoothRiskFeatures(opts: {
  day: number;
  points: RiskSamplePoint[];
  categoryLabel: Record<BomRiskCategoryId, string>;
  categoryOrder: Record<BomRiskCategoryId, number>;
  styleFor: (id: BomRiskCategoryId) => DisplayFeature["style"];
}): DisplayFeature[] {
  const { day, points, categoryLabel, categoryOrder, styleFor } = opts;
  if (!points.length) return [];

  const features: DisplayFeature[] = [];

  // Nested BoM bands: each level covers all areas at or above that risk.
  for (let minRank = 1; minRank <= 4; minRank++) {
    const active = points.filter((p) => p.rank >= minRank);
    if (!active.length) continue;

    const radius = RADIUS_KM_BY_RANK[minRank] ?? 250;
    const rings = active.map((p) => circleRing(p.lat, p.lon, radius));
    const geometry = ringsToGeometry(rings);
    if (!geometry) continue;

    const id = ID_BY_RANK[minRank]!;
    features.push({
      id: `bom-smooth-d${day}-${id}`,
      geometry,
      title: categoryLabel[id],
      categoryId: id,
      order: categoryOrder[id],
      style: styleFor(id),
    });
  }

  features.sort((a, b) => a.order - b.order);
  return features;
}
