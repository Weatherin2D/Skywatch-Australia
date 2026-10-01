/** Aggregate live lightning into storm-activity hotspots for the home panel. */

import type { LightningStrike } from "@/lib/weather/lightning";
import { LIGHTNING_AU_BOUNDS } from "@/lib/weather/lightning";
import { getLiveLightningSnapshot } from "@/lib/weather/blitzortung-feed";

export type StormHotspot = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  strikes15m: number;
  strikes60m: number;
  ratePerMin: number;
  maxIntensity: number;
};

export type StormActivityPayload = {
  generated: number;
  status: string;
  total15m: number;
  total60m: number;
  ratePerMin: number;
  hotspots: StormHotspot[];
  /** Coarse national density grid for the mini map (row-major, south→north). */
  grid: {
    cols: number;
    rows: number;
    west: number;
    east: number;
    south: number;
    north: number;
    cells: number[];
  };
  attribution: string;
};

const REGIONS: { label: string; south: number; north: number; west: number; east: number }[] = [
  { label: "far north QLD", south: -16, north: -10, west: 141, east: 146 },
  { label: "north QLD", south: -22, north: -16, west: 144, east: 148 },
  { label: "SE QLD", south: -29, north: -22, west: 150, east: 154 },
  { label: "eastern NSW", south: -35, north: -28, west: 149, east: 154 },
  { label: "southern NSW", south: -38, north: -35, west: 147, east: 151 },
  { label: "eastern VIC", south: -39.5, north: -36, west: 146, east: 150 },
  { label: "central VIC", south: -39, north: -36, west: 142, east: 146 },
  { label: "northern VIC", south: -37, north: -34, west: 142, east: 147 },
  { label: "TAS", south: -44, north: -40, west: 144, east: 149 },
  { label: "SA", south: -38, north: -30, west: 132, east: 141 },
  { label: "southern WA", south: -36, north: -30, west: 114, east: 125 },
  { label: "NW WA", south: -25, north: -14, west: 113, east: 128 },
  { label: "Top End NT", south: -16, north: -10, west: 129, east: 138 },
  { label: "central Australia", south: -28, north: -20, west: 129, east: 138 },
];

function regionFor(lat: number, lon: number): string {
  for (const r of REGIONS) {
    if (lat >= r.south && lat < r.north && lon >= r.west && lon < r.east) {
      return r.label;
    }
  }
  if (lon < 120) return "western WA";
  if (lon > 150) return "Coral Sea";
  if (lat > -20) return "northern Australia";
  if (lat < -38) return "southern Australia";
  return "inland Australia";
}

export function summarizeStormActivity(
  strikes: LightningStrike[],
  nowSec = Math.floor(Date.now() / 1000),
): StormActivityPayload {
  const cut15 = nowSec - 15 * 60;
  const cut60 = nowSec - 60 * 60;
  const recent60 = strikes.filter((s) => s.time >= cut60 && s.time <= nowSec + 60);
  const recent15 = recent60.filter((s) => s.time >= cut15);

  type Acc = {
    label: string;
    latSum: number;
    lonSum: number;
    n15: number;
    n60: number;
    maxI: number;
  };
  const byRegion = new Map<string, Acc>();
  for (const s of recent60) {
    const label = regionFor(s.lat, s.lon);
    let acc = byRegion.get(label);
    if (!acc) {
      acc = { label, latSum: 0, lonSum: 0, n15: 0, n60: 0, maxI: 0 };
      byRegion.set(label, acc);
    }
    acc.n60 += 1;
    acc.latSum += s.lat;
    acc.lonSum += s.lon;
    acc.maxI = Math.max(acc.maxI, Math.abs(s.intensity || 0));
    if (s.time >= cut15) acc.n15 += 1;
  }

  const hotspots = [...byRegion.values()]
    .filter((a) => a.n60 >= 3)
    .sort((a, b) => b.n15 - a.n15 || b.n60 - a.n60)
    .slice(0, 4)
    .map((a, idx) => ({
      id: `hs-${idx}-${a.label.replace(/\s+/g, "-")}`,
      label: a.label,
      lat: a.latSum / a.n60,
      lon: a.lonSum / a.n60,
      strikes15m: a.n15,
      strikes60m: a.n60,
      ratePerMin: Math.round((a.n15 / 15) * 10) / 10,
      maxIntensity: a.maxI,
    }));

  const cols = 24;
  const rows = 18;
  const { west, east, south, north } = LIGHTNING_AU_BOUNDS;
  const cells = new Array(cols * rows).fill(0);
  for (const s of recent60) {
    const x = Math.floor(((s.lon - west) / (east - west)) * cols);
    const y = Math.floor(((s.lat - south) / (north - south)) * rows);
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    cells[y * cols + x] += 1;
  }

  return {
    generated: nowSec,
    status: "ok",
    total15m: recent15.length,
    total60m: recent60.length,
    ratePerMin: Math.round((recent15.length / 15) * 10) / 10,
    hotspots,
    grid: { cols, rows, west, east, south, north, cells },
    attribution: "Blitzortung / LightningMaps open lightning network",
  };
}

export async function fetchStormActivity(): Promise<StormActivityPayload> {
  const snap = await getLiveLightningSnapshot();
  const payload = summarizeStormActivity(snap.strikes);
  return {
    ...payload,
    status: snap.status,
    attribution: snap.attribution || payload.attribution,
  };
}
