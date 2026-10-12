import { fetchSkywatchAiPredictPoint, skywatchAiBaseUrl } from "@/lib/weather/skywatch-ai-client";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type CycloneTrackPoint = {
  label: string;
  lat: number;
  lon: number;
  category: string;
  time: string;
};

export type CycloneModelRun = {
  label: string;
  value: string;
  hint: string;
};

export type CycloneImpact = {
  title: string;
  detail: string;
  tone: string;
};

export type CycloneUpdate = {
  time: string;
  text: string;
};

export type CycloneGroup = "Australian" | "Overseas";

export type Cyclone = {
  id: string;
  group: CycloneGroup;
  name: string;
  category: "Category 1" | "Category 2" | "Category 3" | "Category 4" | "Category 5" | "Unclassified";
  status: string;
  summary: string;
  positionLabel: string;
  basin: string;
  advisoryText: string;
  source: string;
  aiSource: string;
  aiSummary: string;
  aiConfidence: string;
  lat: number | null;
  lon: number | null;
  pressureHpa: number | null;
  maxWindKmh: number | null;
  movementDir: string;
  movementKmh: number | null;
  warning: string;
  currentWarnings: string[];
  track: CycloneTrackPoint[];
  forecastCone: Array<[number, number]>;
  forecastConeSource: string | null;
  forecastBands: Array<{ label: string; value: string; heightPct: number; tint: string }>;
  modelRuns: CycloneModelRun[];
  impacts: CycloneImpact[];
  updates: CycloneUpdate[];
  lastUpdated: string;
};

export type CyclonePayload = {
  generatedAt: string;
  cyclones: Cyclone[];
  sourceStatus: {
    australian: "live" | "unavailable" | "fallback";
    overseas: "live" | "unavailable" | "fallback";
  };
};

export const ACTIVE_CYCLONE_PAYLOAD: CyclonePayload = {
  generatedAt: "2026-10-10T04:00:00.000Z",
  sourceStatus: { australian: "fallback", overseas: "unavailable" },
  cyclones: [
    {
      id: "halcyon",
      group: "Australian",
      name: "HALCYON",
      category: "Category 4",
      status: "Severe Tropical Cyclone",
      summary:
        "Halcyon remains a powerful Category 4 cyclone with a well-defined eye. Gradual strengthening is likely as it tracks west towards the Queensland coast over the next 24 hours.",
      positionLabel: "18.7°S, 146.2°E",
      basin: "Coral Sea / Queensland coast",
      advisoryText:
        "Severe tropical cyclone conditions are likely to develop along the Queensland coast within the next advisory window. Residents should prepare for damaging winds, prolonged rainfall and dangerous surf.",
      source: "Saved demo snapshot",
      aiSource: "Thunderstate experimental model",
      aiSummary:
        "Experimental steering guidance suggests a westward track with moderate confidence, with the system remaining a broad coastal-risk feature through the next 48 to 72 hours.",
      aiConfidence: "Moderate",
      lat: -18.7,
      lon: 146.2,
      pressureHpa: 925,
      maxWindKmh: 165,
      movementDir: "W",
      movementKmh: 12,
      warning: "Severe Tropical Cyclone Warning — Queensland Coast (Port Douglas to Bowen)",
      currentWarnings: [
        "Severe Tropical Cyclone Warning",
        "Tropical Cyclone Watch",
        "Strong Wind Warning",
        "High Seas Warning",
      ],
      track: [
        { label: "Fri 10 Oct", lat: -16.2, lon: 145.9, category: "Cat 4", time: "2026-10-10T04:00:00Z" },
        { label: "Sat 11 Oct", lat: -17.4, lon: 145.4, category: "Cat 4", time: "2026-10-11T04:00:00Z" },
        { label: "Sun 12 Oct", lat: -18.7, lon: 144.9, category: "Cat 3", time: "2026-10-12T04:00:00Z" },
        { label: "Mon 13 Oct", lat: -19.1, lon: 144.4, category: "Cat 3", time: "2026-10-13T04:00:00Z" },
        { label: "Tue 14 Oct", lat: -19.6, lon: 143.8, category: "Cat 2", time: "2026-10-14T04:00:00Z" },
        { label: "Wed 15 Oct", lat: -20.1, lon: 143.1, category: "Cat 1", time: "2026-10-15T04:00:00Z" },
      ],
      forecastCone: [],
      forecastConeSource: null,
      forecastBands: [
        { label: "Now", value: "103 mph / 165 km/h", heightPct: 78, tint: "bg-rose-500/80" },
        { label: "24h", value: "106 mph / 170 km/h", heightPct: 72, tint: "bg-orange-500/80" },
        { label: "48h", value: "93 mph / 150 km/h", heightPct: 63, tint: "bg-amber-400/80" },
        { label: "72h", value: "75 mph / 120 km/h", heightPct: 52, tint: "bg-cyan-400/80" },
        { label: "96h", value: "56 mph / 90 km/h", heightPct: 42, tint: "bg-sky-500/70" },
        { label: "120h", value: "50 mph / 80 km/h", heightPct: 34, tint: "bg-sky-400/65" },
      ],
      modelRuns: [
        { label: "AI track 12h", value: "+10 km", hint: "Close to current motion" },
        { label: "AI track 24h", value: "+32 km", hint: "Mostly westward drift" },
        { label: "AI track 48h", value: "+66 km", hint: "Coastal approach" },
        { label: "Uncertainty cone", value: "Moderate", hint: "Higher off-shore variance" },
      ],
      impacts: [
        {
          title: "Destructive winds",
          detail: "Damaging gusts and dangerous surf likely from late Friday.",
          tone: "bg-rose-500/15 text-rose-200",
        },
        {
          title: "Heavy rainfall",
          detail: "Flooding risk rises across coastal catchments and rivers.",
          tone: "bg-amber-500/15 text-amber-200",
        },
        {
          title: "Large swells",
          detail: "Ocean conditions remain hazardous for vessels and coastal communities.",
          tone: "bg-cyan-500/15 text-cyan-200",
        },
      ],
      updates: [
        { time: "10 Oct 14:00", text: "Halcyon upgraded to Category 4" },
        { time: "10 Oct 11:30", text: "Forecast track updated" },
        { time: "10 Oct 08:15", text: "Gale warning issued for coastal areas" },
        { time: "10 Oct 06:20", text: "Satellite imagery updated" },
        { time: "09 Oct 22:30", text: "Intensity trend continues to strengthen" },
      ],
      lastUpdated: "2026-10-10T04:00:00.000Z",
    },
  ],
};

function categoryToLabel(raw: string | number | null | undefined): Cyclone["category"] {
  const value = Number(raw ?? 0);
  if (value >= 5 || /5/.test(String(raw ?? ""))) return "Category 5";
  if (value >= 4 || /4/.test(String(raw ?? ""))) return "Category 4";
  if (value >= 3 || /3/.test(String(raw ?? ""))) return "Category 3";
  if (value >= 2 || /2/.test(String(raw ?? ""))) return "Category 2";
  if (value >= 1 || /1/.test(String(raw ?? ""))) return "Category 1";
  return "Unclassified";
}

function compassFromDegrees(deg: number | null | undefined): string {
  const normalizedDeg = Number.isFinite(deg) ? Number(deg) : 270;
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((normalizedDeg % 360) / 45)) % 8;
  return points[idx] ?? "W";
}

function formatLatLon(lat: number | null | undefined, lon: number | null | undefined): string {
  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lon !== "number" || !Number.isFinite(lon)) {
    return "Position not reported";
  }
  const latValue = typeof lat === "number" && Number.isFinite(lat) ? Math.abs(lat) : 0;
  const lonValue = typeof lon === "number" && Number.isFinite(lon) ? Math.abs(lon) : 0;
  const latDir = typeof lat === "number" && lat >= 0 ? "N" : "S";
  const lonDir = typeof lon === "number" && lon >= 0 ? "E" : "W";
  return `${latValue.toFixed(1)}°${latDir}, ${lonValue.toFixed(1)}°${lonDir}`;
}

function buildTrack(lat: number, lon: number, movementDir: string, movementKmh: number): CycloneTrackPoint[] {
  const labelSet = ["Now", "+12h", "+24h", "+36h", "+48h", "+72h"];
  const dirX = { N: 0, NE: 1, E: 1, SE: 1, S: 0, SW: -1, W: -1, NW: -1 };
  const dirY = { N: -1, NE: -1, E: 0, SE: 1, S: 1, SW: 1, W: 0, NW: -1 };
  const xStep = dirX[movementDir as keyof typeof dirX] ?? -1;
  const yStep = dirY[movementDir as keyof typeof dirY] ?? -1;

  return labelSet.map((label, index) => {
    const hours = index === 0 ? 0 : index * 12;
    const driftLat = hours * (movementKmh / 95) * (yStep || 0.3);
    const driftLon = hours * (movementKmh / 95) * (xStep || 0.4);
    const trackLat = lat + driftLat;
    const trackLon = lon + driftLon;
    return {
      label,
      lat: Number(trackLat.toFixed(2)),
      lon: Number(trackLon.toFixed(2)),
      category: index <= 1 ? "Cat 4" : index <= 3 ? "Cat 3" : index <= 4 ? "Cat 2" : "Cat 1",
      time: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
    };
  });
}

export function formatWindSpeedKmh(windKmh: number): string {
  const roundedKmh = Math.round(windKmh);
  return `${Math.round(roundedKmh / 1.609344)} mph / ${roundedKmh} km/h`;
}

function buildForecastBands(maxWindKmh: number) {
  const values = [
    { label: "Now", value: formatWindSpeedKmh(maxWindKmh), heightPct: 78, tint: "bg-rose-500/80" },
    { label: "24h", value: formatWindSpeedKmh(maxWindKmh * 0.96), heightPct: 72, tint: "bg-orange-500/80" },
    { label: "48h", value: formatWindSpeedKmh(maxWindKmh * 0.88), heightPct: 63, tint: "bg-amber-400/80" },
    { label: "72h", value: formatWindSpeedKmh(maxWindKmh * 0.75), heightPct: 52, tint: "bg-cyan-400/80" },
    { label: "96h", value: formatWindSpeedKmh(maxWindKmh * 0.6), heightPct: 42, tint: "bg-sky-500/70" },
    { label: "120h", value: formatWindSpeedKmh(maxWindKmh * 0.5), heightPct: 34, tint: "bg-sky-400/65" },
  ];
  return values;
}

function buildModelRunsFromAi(maxWindKmh: number, ai?: { shiftKm?: number; confidence?: string } | null): Array<{ label: string; value: string; hint: string }> {
  if (ai) {
    return [
      { label: "AI track 12h", value: `${ai.shiftKm ? `+${ai.shiftKm} km` : "+8 km"}`, hint: ai.confidence ? `Confidence ${ai.confidence}` : "Close to current motion" },
      { label: "AI track 24h", value: `${Math.round(maxWindKmh * 0.78)} km/h`, hint: "Westward steering remains likely" },
      { label: "AI track 48h", value: `${Math.round(maxWindKmh * 0.55)} km/h`, hint: "Coastal approach may broaden" },
      { label: "Uncertainty cone", value: ai.confidence ?? "Moderate", hint: "Path spread is manageable but not negligible" },
    ];
  }
  return [
    { label: "AI track 12h", value: "+10 km", hint: "Close to current motion" },
    { label: "AI track 24h", value: "+32 km", hint: "Mostly westward drift" },
    { label: "AI track 48h", value: "+66 km", hint: "Coastal approach" },
    { label: "Uncertainty cone", value: "Moderate", hint: "Higher off-shore variance" },
  ];
}

function makeImpactCards(): Cyclone["impacts"] {
  return [
    {
      title: "Destructive winds",
      detail: "Damaging gusts and dangerous surf likely from the next advisory window.",
      tone: "bg-rose-500/15 text-rose-200",
    },
    {
      title: "Heavy rainfall",
      detail: "Flooding risk rises across exposed coastal catchments and river systems.",
      tone: "bg-amber-500/15 text-amber-200",
    },
    {
      title: "Large swells",
      detail: "Ocean conditions remain hazardous for vessels and coastal communities.",
      tone: "bg-cyan-500/15 text-cyan-200",
    },
  ];
}

function describeAiForecast(
  aiForecast: Awaited<ReturnType<typeof fetchSkywatchAiPredictPoint>>,
  maxWindKmh: number,
  movementDir: string,
): { aiSummary: string; aiConfidence: string } {
  if (!aiForecast) {
    return {
      aiSummary:
        "AI forecast guidance is unavailable right now; the live advisory feed and official track data remain the primary reference.",
      aiConfidence: "Unavailable",
    };
  }

  const diagnostics = aiForecast.diagnostics ?? {};
  const steering = Math.abs(Number(diagnostics.storm_motion_u ?? 0)) + Math.abs(Number(diagnostics.storm_motion_v ?? 0));
  const shear = Number(diagnostics.shear_0_6km ?? 0);
  const confidence = steering > 40 || shear > 18 ? "High" : steering > 20 || shear > 8 ? "Moderate" : "Low";
  const steeringText = ["W", "SW", "NW"].includes(movementDir) ? "westward steering" : ["E", "SE", "NE"].includes(movementDir) ? "eastward steering" : "broadly persistent steering";
  const intensityText = maxWindKmh >= 150 ? "continued intense convection" : maxWindKmh >= 110 ? "sustained core organisation" : "a more moderate wind structure";

  return {
    aiSummary: `Experimental guidance points to ${steeringText} over the next 24–48 hours, with ${intensityText} and a ${confidence.toLowerCase()} confidence signal in the current track envelope.`,
    aiConfidence: confidence,
  };
}

const BOM_WARNINGS_API = "https://api.bom.gov.au/apikey/v1/warnings";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const NHC_KML_PARSER = new XMLParser({ ignoreAttributes: false, trimValues: true });

function asArray(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

async function fetchNhcKml(urlValue: unknown): Promise<Record<string, unknown> | null> {
  if (typeof urlValue !== "string") return null;
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" || url.hostname !== "www.nhc.noaa.gov") return null;
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.google-earth.kmz, application/octet-stream" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 5_000_000) return null;
    const archive = unzipSync(bytes);
    const kml = Object.entries(archive).find(([fileName, content]) => fileName.toLowerCase().endsWith(".kml") && content.byteLength <= 2_000_000)?.[1];
    if (!kml) return null;
    return asRecord(NHC_KML_PARSER.parse(strFromU8(kml)));
  } catch {
    return null;
  }
}

function getKmlPlacemarks(parsed: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const root = asRecord(parsed?.kml);
  const document = asRecord(root?.Document);
  function collectPlacemarks(value: unknown): Array<Record<string, unknown>> {
    const record = asRecord(value);
    if (!record) return Array.isArray(value) ? value.flatMap(collectPlacemarks) : [];
    const placemarks = asArray(record.Placemark)
      .map(asRecord)
      .filter((placemark): placemark is Record<string, unknown> => placemark !== null);
    return [
      ...placemarks,
      ...Object.entries(record)
        .filter(([key]) => key !== "Placemark")
        .flatMap(([, nested]) => collectPlacemarks(nested)),
    ];
  }

  return collectPlacemarks(document);
}

function parseKmlCoordinates(value: unknown): Array<[number, number]> {
  if (typeof value !== "string") return [];
  return value.trim().split(/\s+/).flatMap((position) => {
    const [lonText, latText] = position.split(",");
    const lon = Number(lonText);
    const lat = Number(latText);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? [[lat, lon] as [number, number]]
      : [];
  });
}

function collectKmlCoordinateStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKmlCoordinateStrings);
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, nested]) =>
    key === "coordinates" && typeof nested === "string"
      ? [nested]
      : collectKmlCoordinateStrings(nested),
  );
}

function extractNhcForecastCone(parsed: Record<string, unknown> | null): Array<[number, number]> {
  const polygons = getKmlPlacemarks(parsed).flatMap((placemark) =>
    asArray(placemark.Polygon).flatMap((polygon) => collectKmlCoordinateStrings(polygon).map(parseKmlCoordinates)),
  );
  return polygons.sort((left, right) => right.length - left.length)[0] ?? [];
}

function extractNhcForecastTrack(
  parsed: Record<string, unknown> | null,
  category: Cyclone["category"],
  lastUpdated: string,
): CycloneTrackPoint[] {
  const candidates = getKmlPlacemarks(parsed).flatMap((placemark) => {
    const lines = asArray(placemark.LineString).flatMap((line) => collectKmlCoordinateStrings(line).map(parseKmlCoordinates));
    const data = asRecord(placemark.ExtendedData);
    const entries = asArray(data?.Data).map(asRecord);
    const forecastHours = Number(entries.find((entry) => entry?.["@_name"] === "fcstpd")?.value ?? 0);
    return lines.map((positions) => ({ positions, forecastHours }));
  });
  const forecast = candidates.sort((left, right) => right.forecastHours - left.forecastHours || right.positions.length - left.positions.length)[0];
  if (!forecast || forecast.positions.length < 2) return [];

  const standardHours = forecast.forecastHours >= 120 && forecast.positions.length === 8
    ? [0, 12, 24, 36, 48, 72, 96, 120]
    : forecast.forecastHours >= 72 && forecast.positions.length === 7
      ? [0, 12, 24, 36, 48, 60, 72]
      : null;
  const updatedAt = Date.parse(lastUpdated);
  return forecast.positions.map(([lat, lon], index) => {
    const hours = standardHours?.[index] ?? Math.round((forecast.forecastHours * index) / (forecast.positions.length - 1));
    return {
      label: hours === 0 ? "Now" : `+${hours}h`,
      lat,
      lon,
      category,
      time: new Date((Number.isFinite(updatedAt) ? updatedAt : Date.now()) + hours * 60 * 60 * 1000).toISOString(),
    };
  });
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function collectText(value: unknown): string[] {
  if (typeof value === "string") return [plainText(value)];
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectText);
  return [];
}

function parseCoordinates(text: string): Array<{ lat: number; lon: number }> {
  const coordinates: Array<{ lat: number; lon: number }> = [];
  const pattern = /(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\s*[, ]+\s*(\d{2,3}(?:\.\d+)?)\s*°?\s*([EW])/gi;
  for (const match of text.matchAll(pattern)) {
    const lat = Number(match[1]) * (match[2]?.toUpperCase() === "S" ? -1 : 1);
    const lon = Number(match[3]) * (match[4]?.toUpperCase() === "W" ? -1 : 1);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      coordinates.push({ lat, lon });
    }
  }
  return coordinates;
}

async function fetchBomCyclones(): Promise<Cyclone[] | null> {
  try {
    const response = await fetch(`${BOM_WARNINGS_API}/list`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const json = asRecord(await response.json());
    if (!json || !Array.isArray(json.warnings)) return null;

    const candidates = json.warnings
      .map(asRecord)
      .filter((warning): warning is Record<string, unknown> => warning !== null)
      .filter((warning) => /^WTC/i.test(String(warning.type ?? "")) || /tropical cyclone/i.test(plainText(warning.title)));
    const latestByName = new Map<string, Record<string, unknown>>();
    for (const candidate of candidates) {
      const warningTitle = plainText(candidate.dist_title ?? candidate.title);
      const name = plainText(candidate.disturbance_name) || warningTitle.replace(/^Tropical Cyclone\s*/i, "");
      if (!name) continue;
      const key = name.toLowerCase();
      const previous = latestByName.get(key);
      if (!previous || String(candidate.issue_datetime_utc ?? "") > String(previous.issue_datetime_utc ?? "")) {
        latestByName.set(key, { ...candidate, normalizedName: name });
      }
    }

    return Promise.all(
      [...latestByName.values()].map(async (candidate) => {
        const id = String(candidate.id ?? "");
        const detailResponse = id
          ? await fetch(`${BOM_WARNINGS_API}/warning/${encodeURIComponent(id)}`, {
              headers: { Accept: "application/json" },
              cache: "no-store",
              signal: AbortSignal.timeout(12_000),
            }).catch(() => null)
          : null;
        const detail = detailResponse?.ok ? asRecord(await detailResponse.json().catch(() => null)) : null;
        const warning = asRecord(detail?.warning) ?? candidate;
        const allText = collectText([candidate, warning]).filter(Boolean).join(" ");
        const coordinates = parseCoordinates(allText);
        const name = String(candidate.normalizedName ?? "Australian cyclone");
        const categoryMatch = allText.match(/category\s*([1-5])/i);
        const category = categoryToLabel(categoryMatch?.[1]);
        const windMatch = allText.match(/\b(\d{2,3})\s*(?:km\/h|kmh)\b/i);
        const pressureMatch = allText.match(/\b(\d{3,4})\s*hpa\b/i);
        const lat = coordinates[0]?.lat ?? null;
        const lon = coordinates[0]?.lon ?? null;
        const title = plainText(warning.title ?? candidate.title) || `Tropical Cyclone Advice for ${name}`;
        const advisoryText = plainText(warning.advice ?? warning.sub_title ?? warning.area_summary);
        const sourceTime = String(candidate.issue_datetime_utc ?? warning.issued_at ?? new Date().toISOString());

        return {
          id: `bom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
          group: "Australian",
          name: name.toUpperCase(),
          category,
          status: title,
          summary: advisoryText || `${title}. See the official BOM advisory for current details.`,
          positionLabel: formatLatLon(lat, lon),
          basin: `Australian region${candidate.area_state_code ? ` / ${String(candidate.area_state_code)}` : ""}`,
          advisoryText: advisoryText || "Follow the linked Australian Bureau of Meteorology advisory for current guidance.",
          source: "Australian Bureau of Meteorology",
          aiSource: "Not provided by BOM",
          aiSummary: "AI guidance is not available for this advisory record.",
          aiConfidence: "Unavailable",
          lat,
          lon,
          pressureHpa: pressureMatch ? Number(pressureMatch[1]) : null,
          maxWindKmh: windMatch ? Number(windMatch[1]) : null,
          movementDir: "Not reported",
          movementKmh: null,
          warning: title,
          currentWarnings: [title],
          track: coordinates.map((point, index) => ({
            label: index === 0 ? "Advisory position" : `Advisory position ${index + 1}`,
            lat: point.lat,
            lon: point.lon,
            category,
            time: sourceTime,
          })),
          forecastCone: [],
          forecastConeSource: null,
          forecastBands: windMatch ? buildForecastBands(Number(windMatch[1])) : [],
          modelRuns: [],
          impacts: [],
          updates: [{ time: sourceTime, text: title }],
          lastUpdated: sourceTime,
        } satisfies Cyclone;
      }),
    );
  } catch {
    return null;
  }
}

async function fetchLiveCyclones(): Promise<Cyclone[] | null> {
  try {
    const res = await fetch("https://www.nhc.noaa.gov/CurrentStorms.json", {
      headers: { Accept: "application/json", "User-Agent": "Thunderstate/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { activeStorms?: Array<Record<string, unknown>> };
    const storms = json.activeStorms ?? [];

    const mapped = await Promise.all(
      storms.map(async (storm) => {
        const name = String(storm.name ?? "Cyclone");
        const lat = Number(storm.latitudeNumeric ?? 0);
        const lon = Number(storm.longitudeNumeric ?? 0);
        const pressure = Number(storm.pressure ?? 1000);
        const windsKts = Number(storm.intensity ?? 0);
        const classification = (storm.classification as string | number | null | undefined) ?? windsKts;
        const maxWindKmh = Math.round(windsKts * 1.852);
        const movementDir = compassFromDegrees(Number(storm.movementDir ?? 270));
        const movementKmh = Math.round(Number(storm.movementSpeed ?? 0) * 1.852);
        const category = categoryToLabel(classification);
        const status = /HU|TY|TS|ST/.test(String(storm.classification ?? "")) ? "Tropical cyclone" : "Weather system";
        const publicAdvisory = (storm.publicAdvisory ?? null) as Record<string, unknown> | null;
        const advisoryText =
          publicAdvisory && typeof publicAdvisory === "object"
            ? `Advisory ${String(publicAdvisory.advNum ?? "latest")} — active tropical cyclone watch in the current basin.`
            : `Active tropical cyclone advisory for ${name}. Conditions remain dynamic and may evolve rapidly.`;
        const basin = /EP|WP|SP|IO|CP/.test(String(storm.binNumber ?? ""))
          ? "Pacific / tropical basin"
          : "Southern Indian Ocean / Australian region";
        const warning = `Cyclone advisory — ${name}`;
        const lastUpdated = typeof storm.lastUpdate === "string" ? storm.lastUpdate : new Date().toISOString();
        const [forecastTrackKml, forecastConeKml] = await Promise.all([
          fetchNhcKml(asRecord(storm.forecastTrack)?.kmzFile),
          fetchNhcKml(asRecord(storm.trackCone)?.kmzFile),
        ]);
        const track = extractNhcForecastTrack(forecastTrackKml, category, lastUpdated);
        const resolvedTrack = track.length > 1 ? track : buildTrack(lat, lon, movementDir, movementKmh || 12);
        const forecastCone = extractNhcForecastCone(forecastConeKml);
        const aiForecast = skywatchAiBaseUrl()
          ? await fetchSkywatchAiPredictPoint({
              lat,
              lon,
              time: typeof storm.lastUpdate === "string" ? storm.lastUpdate : undefined,
              hemisphere: lat >= 0 ? "N" : "S",
              teacherModel: "pulse",
              timeoutMs: 12_000,
            })
          : null;
        const aiHint = aiForecast
          ? {
              shiftKm: Math.max(8, Math.min(60, Math.round((aiForecast.diagnostics?.storm_motion_u ?? 0) * 6))),
              confidence: "Moderate",
            }
          : null;
        const aiBrief = describeAiForecast(aiForecast, maxWindKmh, movementDir);

        return {
          id: String(storm.id ?? name.toLowerCase().replace(/\s+/g, "-")),
          group: "Overseas",
          name: String(name).toUpperCase(),
          category,
          status,
          summary: `${name} is active in the current tropical basin. Current winds are around ${formatWindSpeedKmh(maxWindKmh)} with a central pressure near ${pressure} hPa.`,
          positionLabel: formatLatLon(lat, lon),
          basin,
          advisoryText,
          source: "NOAA / NHC",
          aiSource: aiForecast ? "Thunderstate experimental model" : "Live advisory feed",
          aiSummary: aiBrief.aiSummary,
          aiConfidence: aiBrief.aiConfidence,
          lat,
          lon,
          pressureHpa: Number.isFinite(pressure) ? Math.round(pressure) : 1000,
          maxWindKmh,
          movementDir,
          movementKmh,
          warning,
          currentWarnings: [
            category === "Category 4" || category === "Category 5" ? "Severe Tropical Cyclone Warning" : "Tropical Cyclone Advisory",
            "Tropical Cyclone Watch",
            "Strong Wind Warning",
          ],
          track: resolvedTrack,
          forecastCone,
          forecastConeSource: forecastCone.length ? "NOAA / NHC official forecast cone" : null,
          forecastBands: buildForecastBands(maxWindKmh),
          modelRuns: buildModelRunsFromAi(maxWindKmh, aiHint),
          impacts: makeImpactCards(),
          updates: [
            { time: "Live advisory", text: `${name} is monitoring across the active basin.` },
            { time: "Model update", text: "Track guidance is being refreshed." },
            { time: "Weather watch", text: "Coastal impacts remain under review." },
          ],
          lastUpdated,
        } satisfies Cyclone;
      }),
    );

    return mapped.filter((storm) => Number.isFinite(storm.lat) && Number.isFinite(storm.lon));
  } catch {
    return null;
  }
}

export async function fetchCyclonePayload(): Promise<CyclonePayload> {
  const [australianCyclones, overseasCyclones] = await Promise.all([
    fetchBomCyclones(),
    fetchLiveCyclones(),
  ]);
  if (australianCyclones !== null || overseasCyclones !== null) {
    return {
      generatedAt: new Date().toISOString(),
      sourceStatus: {
        australian: australianCyclones === null ? "unavailable" : "live",
        overseas: overseasCyclones === null ? "unavailable" : "live",
      },
      cyclones: [...(australianCyclones ?? []), ...(overseasCyclones ?? [])],
    };
  }
  return ACTIVE_CYCLONE_PAYLOAD;
}

export function getCyclonePayload(): CyclonePayload {
  return ACTIVE_CYCLONE_PAYLOAD;
}
