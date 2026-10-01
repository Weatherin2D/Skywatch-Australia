/** Bureau of Meteorology warnings via api.weather.bom.gov.au */

export type WarningPhase =
  | "new"
  | "renewal"
  | "update"
  | "cancellation"
  | "cancelled"
  | "final"
  | string;

export type WarningGroupType = "major" | "minor" | string | null;

/** Visual / sort band used across the UI. */
export type WarningSeverity =
  | "critical"
  | "severe"
  | "moderate"
  | "minor"
  | "cancelled";

/** Display order for category sections (highest first). */
export const WARNING_CATEGORIES = [
  "critical",
  "severe",
  "moderate",
  "minor",
] as const satisfies readonly WarningSeverity[];

export type WarningCategory = (typeof WARNING_CATEGORIES)[number];

export type BomWarningSummary = {
  id: string;
  type: string;
  title: string;
  shortTitle: string;
  state: string;
  states: string[];
  warningGroupType: WarningGroupType;
  issueTime: string | null;
  expiryTime: string | null;
  phase: WarningPhase;
  /** Higher = more urgent. Cancelled are negative. */
  priority: number;
  severity: WarningSeverity;
  severityLabel: string;
  href: string;
};

export type WarningImage = {
  src: string;
  alt: string;
};

export type BomWarningDetail = BomWarningSummary & {
  /** Sanitized HTML body (images removed — shown separately). */
  bodyHtml: string;
  /** Plain-text excerpt for cards / meta. */
  summary: string;
  images: WarningImage[];
  sourceUrl: string;
};

type RawSummary = {
  id?: string;
  type?: string;
  title?: string;
  short_title?: string;
  state?: string;
  states?: string[];
  warning_group_type?: string | null;
  issue_time?: string | null;
  expiry_time?: string | null;
  phase?: string;
};

type RawDetail = RawSummary & {
  message?: string;
};

const BOM_WARNINGS_URL = "https://api.weather.bom.gov.au/v1/warnings";
const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Higher = more urgent. Unknown types default mid-minor. */
const TYPE_PRIORITY: Record<string, number> = {
  tsunami_warning: 100,
  tsunami_watch: 92,
  tropical_cyclone_warning: 98,
  tropical_cyclone_watch: 90,
  emergency_warning: 97,
  fire_weather_warning: 88,
  total_fire_ban: 84,
  severe_thunderstorm_warning: 82,
  severe_weather_warning: 78,
  flood_warning: 74,
  flood_watch: 58,
  coastal_hazard_warning: 62,
  coastal_warning: 55,
  gale_warning: 52,
  storm_force_wind_warning: 70,
  hurricane_force_wind_warning: 80,
  marine_wind_warning: 42,
  sheep_graziers_warning: 28,
  frost_warning: 24,
  freeze_warning: 24,
  road_weather_alert: 30,
};

const LIST_CACHE_MS = 45_000;
let listCache: { at: number; items: BomWarningSummary[] } | null = null;

export function warningHref(id: string): string {
  return `/warnings/${encodeURIComponent(id)}`;
}

export function severityFromPriority(
  priority: number,
  phase: WarningPhase,
): WarningSeverity {
  if (isCancelledPhase(phase) || priority < 0) return "cancelled";
  if (priority >= 90) return "critical";
  if (priority >= 70) return "severe";
  if (priority >= 50) return "moderate";
  return "minor";
}

export function severityLabel(severity: WarningSeverity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "severe":
      return "Severe";
    case "moderate":
      return "Moderate";
    case "minor":
      return "Minor";
    case "cancelled":
      return "Cancelled";
  }
}

export function isWarningCategory(value: string): value is WarningCategory {
  return (WARNING_CATEGORIES as readonly string[]).includes(value);
}

export function groupWarningsByCategory<T extends { severity: WarningSeverity }>(
  items: T[],
): { category: WarningCategory; label: string; items: T[] }[] {
  return WARNING_CATEGORIES.map((category) => ({
    category,
    label: severityLabel(category),
    items: items.filter((w) => w.severity === category),
  })).filter((group) => group.items.length > 0);
}

export function isCancelledPhase(phase: WarningPhase): boolean {
  const p = String(phase || "").toLowerCase();
  return p === "cancelled" || p === "cancellation" || p === "final";
}

export function computePriority(raw: {
  type?: string | null;
  warning_group_type?: string | null;
  phase?: string | null;
  issue_time?: string | null;
}): number {
  const type = (raw.type || "").toLowerCase();
  let score = TYPE_PRIORITY[type] ?? 35;
  const group = (raw.warning_group_type || "").toLowerCase();
  if (group === "major") score += 18;
  else if (group === "minor") score += 0;

  if (isCancelledPhase(raw.phase || "")) {
    score -= 1000;
  }

  // Prefer fresher products when priority ties.
  if (raw.issue_time) {
    const t = Date.parse(raw.issue_time);
    if (Number.isFinite(t)) {
      score += Math.min(5, Math.max(0, (t - Date.now()) / 86_400_000 + 2));
    }
  }
  return Math.round(score * 100) / 100;
}

function normalizeSummary(raw: RawSummary): BomWarningSummary | null {
  const id = (raw.id || "").trim();
  if (!id) return null;
  const phase = (raw.phase || "unknown") as WarningPhase;
  const priority = computePriority(raw);
  const severity = severityFromPriority(priority, phase);
  const states =
    Array.isArray(raw.states) && raw.states.length
      ? raw.states.map(String)
      : raw.state
        ? [String(raw.state)]
        : [];
  return {
    id,
    type: String(raw.type || "warning"),
    title: String(raw.title || raw.short_title || id),
    shortTitle: String(raw.short_title || raw.title || "Warning"),
    state: String(raw.state || states[0] || ""),
    states,
    warningGroupType: (raw.warning_group_type ?? null) as WarningGroupType,
    issueTime: raw.issue_time ?? null,
    expiryTime: raw.expiry_time ?? null,
    phase,
    priority,
    severity,
    severityLabel: severityLabel(severity),
    href: warningHref(id),
  };
}

export function sortWarningsByPriority<T extends { priority: number; id: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });
}

export function activeWarnings(items: BomWarningSummary[]): BomWarningSummary[] {
  return items.filter((w) => !isCancelledPhase(w.phase));
}

export function statesWithWarnings(items: BomWarningSummary[]): string[] {
  const set = new Set<string>();
  for (const w of activeWarnings(items)) {
    for (const s of w.states) {
      if (s) set.add(s.toUpperCase());
    }
  }
  const order = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT", "ACT"];
  return [...set].sort(
    (a, b) =>
      (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
      (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
  );
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "div",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
]);

/** Lightweight whitelist sanitizer for BoM product HTML. */
export function sanitizeWarningHtml(html: string): string {
  if (!html) return "";
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?iframe[\s\S]*?>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, "");

  out = out.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (full, tag: string, attrs = "") => {
    const t = tag.toLowerCase();
    const closing = full.startsWith("</");
    if (t === "img") return ""; // images extracted separately
    if (!ALLOWED_TAGS.has(t)) return "";
    if (closing) return `</${t}>`;
    if (t === "br" || t === "hr") return `<${t} />`;
    if (t === "a") {
      const hrefMatch = attrs.match(/\shref\s*=\s*(['"])(.*?)\1/i);
      const href = hrefMatch?.[2]?.trim() || "";
      if (!/^https?:\/\//i.test(href) && !href.startsWith("/")) {
        return "<span>";
      }
      const safe = href.replace(/"/g, "&quot;");
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">`;
    }
    return `<${t}>`;
  });

  // Fix spans opened instead of bad anchors
  out = out.replace(/<span>([\s\S]*?)<\/a>/gi, "<span>$1</span>");
  return out;
}

export function extractWarningImages(html: string): WarningImage[] {
  if (!html) return [];
  const images: WarningImage[] = [];
  const re = /<img\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    const src = attrs.match(/\ssrc\s*=\s*(['"])([\s\S]*?)\1/i)?.[2]?.trim();
    if (!src) continue;
    if (!src.startsWith("data:image/") && !/^https?:\/\//i.test(src)) continue;
    const alt =
      attrs.match(/\salt\s*=\s*(['"])([\s\S]*?)\1/i)?.[2]?.trim() ||
      "Warning map";
    images.push({ src, alt: alt || "Warning map" });
  }
  return images;
}

export function parseWarningMessage(messageHtml: string): {
  bodyHtml: string;
  summary: string;
  images: WarningImage[];
} {
  const images = extractWarningImages(messageHtml);
  const bodyHtml = sanitizeWarningHtml(messageHtml);
  const summary = stripTags(messageHtml).slice(0, 280);
  return { bodyHtml, summary, images };
}

async function bomGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": FETCH_UA,
    },
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`BoM warnings unavailable (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function fetchBomWarningList(options?: {
  bypassCache?: boolean;
}): Promise<BomWarningSummary[]> {
  const now = Date.now();
  if (
    !options?.bypassCache &&
    listCache &&
    now - listCache.at < LIST_CACHE_MS
  ) {
    return listCache.items;
  }

  const payload = await bomGet<{ data?: RawSummary[] }>(BOM_WARNINGS_URL);
  const items = sortWarningsByPriority(
    (payload.data || [])
      .map(normalizeSummary)
      .filter((x): x is BomWarningSummary => x != null),
  );
  listCache = { at: now, items };
  return items;
}

export async function fetchBomWarningDetail(
  id: string,
): Promise<BomWarningDetail | null> {
  const safeId = id.trim().toUpperCase();
  if (!/^[A-Z0-9_]{4,40}$/.test(safeId)) return null;

  const payload = await bomGet<{ data?: RawDetail | null }>(
    `${BOM_WARNINGS_URL}/${encodeURIComponent(safeId)}`,
  );
  const raw = payload.data;
  if (!raw?.id) return null;

  const summary = normalizeSummary(raw);
  if (!summary) return null;
  const parsed = parseWarningMessage(raw.message || "");

  return {
    ...summary,
    bodyHtml: parsed.bodyHtml,
    summary: parsed.summary,
    images: parsed.images,
    sourceUrl: `https://www.bom.gov.au/australia/warnings/`,
  };
}

export function formatWarningTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(d);
}

export function humanizeWarningType(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
