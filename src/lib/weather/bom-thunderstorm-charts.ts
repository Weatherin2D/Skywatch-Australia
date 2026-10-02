/**
 * Official BoM state Thunderstorm Forecast map sheets (Day 1 / Day 2).
 *
 * Product IDs follow ID{state}21031 (Day 1) / ID{state}21032 (Day 2).
 * Public mirrors publish some of these with an embedded PNG (EM Walls).
 */

import type { MapRegionId } from "@/components/home/mock-data";

const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CACHE_MS = 15 * 60_000;

/** Region → BoM product state prefix. */
const REGION_PRODUCT_PREFIX: Partial<Record<MapRegionId, string>> = {
  vic: "IDV",
  nsw: "IDN",
  qld: "IDQ",
  sa: "IDS",
  wa: "IDW",
  tas: "IDT",
  nt: "IDD",
};

type ChartRecord = {
  at: number;
  png: Buffer | null;
  issuedText: string | null;
  productId: string;
};

const chartCache = new Map<string, ChartRecord>();
const inflight = new Map<string, Promise<ChartRecord>>();

function productIdFor(regionId: MapRegionId, day: 1 | 2 | 3): string | null {
  if (day === 3) return null; // BoM thunderstorm forecast charts are Day 1–2.
  const prefix = REGION_PRODUCT_PREFIX[regionId];
  if (!prefix) return null;
  return `${prefix}${day === 1 ? "21031" : "21032"}`;
}

function chartUrls(productId: string): string[] {
  return [
    `https://files-em.em.vic.gov.au/public/Walls/${productId}.html`,
    `https://files-em.em.vic.gov.au/public/Walls/${productId}.shtml`,
    `https://www.bom.gov.au/fwo/${productId}.html`,
    `https://www.bom.gov.au/fwo/${productId}.shtml`,
  ];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": FETCH_UA,
          Accept: "text/html,*/*",
          Referer: "https://www.bom.gov.au/",
        },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) return null;
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("html") && !ctype.includes("text")) return null;
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function extractEmbeddedPng(html: string): Buffer | null {
  const m = html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  if (!m?.[1]) return null;
  try {
    return Buffer.from(m[1], "base64");
  } catch {
    return null;
  }
}

function extractIssued(html: string): string | null {
  const m = html.match(/Issued at[^.<]{0,80}/i);
  return m?.[0]?.trim() ?? null;
}

async function loadChart(productId: string): Promise<ChartRecord> {
  const cached = chartCache.get(productId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;

  const existing = inflight.get(productId);
  if (existing) return existing;

  const job = (async () => {
    for (const url of chartUrls(productId)) {
      const html = await fetchText(url);
      if (!html) continue;
      const png = extractEmbeddedPng(html);
      if (!png || png.length < 500) continue;
      const record: ChartRecord = {
        at: Date.now(),
        png,
        issuedText: extractIssued(html),
        productId,
      };
      chartCache.set(productId, record);
      return record;
    }
    const empty: ChartRecord = {
      at: Date.now(),
      png: null,
      issuedText: null,
      productId,
    };
    chartCache.set(productId, empty);
    return empty;
  })().finally(() => {
    inflight.delete(productId);
  });

  inflight.set(productId, job);
  return job;
}

export type OfficialThunderstormChart = {
  productId: string;
  png: Buffer;
  issuedText: string | null;
  display: "sheet";
};

/** Official BoM Thunderstorm Forecast sheet for a state region + day, if published. */
export async function getOfficialThunderstormChart(
  regionId: MapRegionId,
  day: 1 | 2 | 3,
): Promise<OfficialThunderstormChart | null> {
  const productId = productIdFor(regionId, day);
  if (!productId) return null;
  const record = await loadChart(productId);
  if (!record.png) return null;
  return {
    productId: record.productId,
    png: record.png,
    issuedText: record.issuedText,
    display: "sheet",
  };
}

const CHART_STATE_REGIONS = Object.keys(REGION_PRODUCT_PREFIX) as MapRegionId[];

/** Which state Day 1/2 Thunderstorm Forecast charts are currently published. */
export async function listAvailableThunderstormCharts(
  day: 1 | 2 | 3,
): Promise<Array<{ regionId: MapRegionId; productId: string }>> {
  if (day === 3) return [];
  const out: Array<{ regionId: MapRegionId; productId: string }> = [];
  await Promise.all(
    CHART_STATE_REGIONS.map(async (regionId) => {
      const chart = await getOfficialThunderstormChart(regionId, day);
      if (chart) out.push({ regionId, productId: chart.productId });
    }),
  );
  return out.sort((a, b) => a.regionId.localeCompare(b.regionId));
}
