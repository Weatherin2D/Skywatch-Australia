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

/**
 * Category key (user-defined):
 * - Critical — detailed / very dangerous severe thunderstorm; very dangerous severe weather
 * - Severe — severe thunderstorm / severe weather warnings; major flood warnings
 * - Moderate — flood warnings (moderate, minor); flood watches (major, moderate)
 * - Minor — flood watches (minor); marine wind warnings
 * Other BoM products are allocated to the nearest matching class below.
 */
const SEVERITY_BASE_PRIORITY: Record<WarningSeverity, number> = {
  critical: 400,
  severe: 300,
  moderate: 200,
  minor: 100,
  cancelled: -1000,
};

/** Types that need product text to classify accurately. */
const NEEDS_TEXT_TYPES = new Set([
  "severe_thunderstorm_warning",
  "severe_weather_warning",
  "flood_warning",
  "flood_watch",
]);

export type FloodLevel = "major" | "moderate" | "minor";

const LIST_CACHE_MS = 45_000;
let listCache: { at: number; items: BomWarningSummary[] } | null = null;

export function warningHref(id: string): string {
  return `/warnings/${encodeURIComponent(id)}`;
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

export function isVeryDangerousText(text: string): boolean {
  return /\bvery\s+dangerous\b/i.test(text);
}

/**
 * BoM cell-tracked "Detailed Severe Thunderstorm Warning" products.
 * Matches product identity in short_title / title / body lead-in.
 * District STWs that only cross-reference a detailed product
 * ("a more Detailed Severe Thunderstorm Warning has been issued") stay Severe.
 */
export function isDetailedSevereThunderstormText(text: string): boolean {
  if (!text) return false;

  // Drop district cross-references before testing product identity.
  const cleaned = text
    .replace(
      /\b(?:a\s+more|the\s+more|more)\s+detailed\s+severe\s+thunderstorm\s+warning\b[^.\n]{0,160}/gi,
      " ",
    )
    .replace(
      /\b(?:refer\s+to|see(?:\s+also)?)\s+(?:the\s+)?detailed\s+severe\s+thunderstorm\s+warning\b[^.\n]{0,160}/gi,
      " ",
    );

  // short_title / title line (classificationText joins with newlines).
  if (/^\s*detailed\s+severe\s+thunderstorm\s+warning\b/im.test(cleaned)) {
    return true;
  }

  // Canonical body lead-in, including cancellations of detailed products.
  return (
    /\bdetailed\s+severe\s+thunderstorm\s+warning\s+for\b/i.test(cleaned) ||
    /\bcancellation\s+of\s+detailed\s+severe\s+thunderstorm\s+warning\b/i.test(
      cleaned,
    )
  );
}

/**
 * Detect the highest flood magnitude mentioned in product text.
 * Ranges like "minor to moderate" resolve to the higher end.
 */
export function detectFloodLevel(text: string): FloodLevel | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\s+/g, " ");
  if (!/\bflood/.test(t)) return null;

  let best: FloodLevel | null = null;
  const raise = (level: FloodLevel) => {
    const rank = { minor: 1, moderate: 2, major: 3 };
    if (!best || rank[level] > rank[best]) best = level;
  };

  // Explicit ranges first
  if (/minor\s+to\s+major/.test(t) || /moderate\s+to\s+major/.test(t)) {
    raise("major");
  }
  if (/minor\s+to\s+moderate/.test(t) || /moderate\s+to\s+minor/.test(t)) {
    raise("moderate");
  }
  if (/major\s+to\s+moderate/.test(t)) raise("major");

  if (/\bmajor\s+flood|\bflood(?:ing)?\b[^.]{0,40}\bmajor\b|\bmajor\b[^.]{0,40}\bflood/.test(t)) {
    raise("major");
  }
  if (
    /\bmoderate\s+flood|\bflood(?:ing)?\b[^.]{0,40}\bmoderate\b|\bmoderate\b[^.]{0,40}\bflood/.test(
      t,
    )
  ) {
    raise("moderate");
  }
  if (/\bminor\s+flood|\bflood(?:ing)?\b[^.]{0,40}\bminor\b|\bminor\b[^.]{0,40}\bflood/.test(t)) {
    raise("minor");
  }

  return best;
}

function classificationText(
  raw: {
    title?: string | null;
    short_title?: string | null;
  },
  messageHtml?: string,
): string {
  const parts = [
    raw.short_title || "",
    raw.title || "",
    messageHtml ? stripTags(messageHtml) : "",
  ];
  return parts.join(" \n ");
}

/**
 * Map a BoM warning into Critical / Severe / Moderate / Minor.
 */
export function classifyWarningSeverity(
  raw: {
    type?: string | null;
    warning_group_type?: string | null;
    phase?: string | null;
    title?: string | null;
    short_title?: string | null;
  },
  messageHtml?: string,
): WarningSeverity {
  if (isCancelledPhase(raw.phase || "")) return "cancelled";

  const type = String(raw.type || "").toLowerCase();
  const group = String(raw.warning_group_type || "").toLowerCase();
  const text = classificationText(raw, messageHtml);

  // --- User key: severe thunderstorm / severe weather ---
  if (type === "severe_thunderstorm_warning") {
    if (isVeryDangerousText(text) || isDetailedSevereThunderstormText(text)) {
      return "critical";
    }
    return "severe";
  }
  if (type === "severe_weather_warning") {
    return isVeryDangerousText(text) ? "critical" : "severe";
  }

  // --- User key: flood warnings ---
  if (type === "flood_warning") {
    const level =
      detectFloodLevel(text) ?? (group === "major" ? "major" : "minor");
    // Major flood warning → Severe; moderate/minor flood warning → Moderate
    return level === "major" ? "severe" : "moderate";
  }

  // --- User key: flood watches ---
  if (type === "flood_watch") {
    const level =
      detectFloodLevel(text) ??
      (group === "major" ? "major" : group === "minor" ? "minor" : null);
    // Major/moderate flood watch → Moderate; minor flood watch → Minor
    if (level === "minor") return "minor";
    if (level === "major" || level === "moderate") return "moderate";
    return group === "major" ? "moderate" : "minor";
  }

  // --- User key: marine wind ---
  if (type === "marine_wind_warning" || type.startsWith("marine_")) {
    return "minor";
  }

  // --- Other products allocated to the nearest class ---
  if (
    type === "tsunami_warning" ||
    type === "tropical_cyclone_warning" ||
    type === "emergency_warning" ||
    type === "hurricane_force_wind_warning"
  ) {
    return "critical";
  }

  if (
    type === "tsunami_watch" ||
    type === "tropical_cyclone_watch" ||
    type === "fire_weather_warning" ||
    type === "storm_force_wind_warning" ||
    type === "coastal_hazard_warning"
  ) {
    return "severe";
  }

  if (
    type === "total_fire_ban" ||
    type === "gale_warning" ||
    type === "coastal_warning"
  ) {
    return "moderate";
  }

  // Sheep graziers, frost, freeze, road alerts, unknowns → Minor
  return "minor";
}

export function computePriority(raw: {
  type?: string | null;
  warning_group_type?: string | null;
  phase?: string | null;
  issue_time?: string | null;
  title?: string | null;
  short_title?: string | null;
}, messageHtml?: string): number {
  const severity = classifyWarningSeverity(raw, messageHtml);
  let score = SEVERITY_BASE_PRIORITY[severity];

  // Stable within-band ordering: prefer fresher products.
  if (raw.issue_time) {
    const t = Date.parse(raw.issue_time);
    if (Number.isFinite(t)) {
      score += Math.min(5, Math.max(0, (t - Date.now()) / 86_400_000 + 2));
    }
  }
  return Math.round(score * 100) / 100;
}

function normalizeSummary(
  raw: RawSummary,
  messageHtml?: string,
): BomWarningSummary | null {
  const id = (raw.id || "").trim();
  if (!id) return null;
  const phase = (raw.phase || "unknown") as WarningPhase;
  const severity = classifyWarningSeverity(raw, messageHtml);
  const priority = computePriority(raw, messageHtml);
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
  const rawItems = payload.data || [];

  // Pull product text for flood / severe weather so levels, detailed STW & "very dangerous" classify correctly.
  const messages = new Map<string, string>();
  await Promise.all(
    rawItems.map(async (raw) => {
      const id = (raw.id || "").trim();
      const type = String(raw.type || "").toLowerCase();
      if (!id || !NEEDS_TEXT_TYPES.has(type)) return;
      if (isCancelledPhase(raw.phase || "")) return;
      try {
        const detail = await bomGet<{ data?: RawDetail | null }>(
          `${BOM_WARNINGS_URL}/${encodeURIComponent(id)}`,
        );
        if (detail.data?.message) messages.set(id, detail.data.message);
      } catch {
        // Fall back to title/group-only classification.
      }
    }),
  );

  const items = sortWarningsByPriority(
    rawItems
      .map((raw) =>
        normalizeSummary(raw, messages.get((raw.id || "").trim())),
      )
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

  const summary = normalizeSummary(raw, raw.message || "");
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
