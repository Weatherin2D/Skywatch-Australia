/** Client-side warning alert preferences (localStorage + Notifications). */

const PREFS_KEY = "skywatch.alerts.v1";
const NOTIFIED_KEY = "skywatch.alerts.notified.v1";

export type AlertSeverityFloor = "critical" | "severe";

export type AlertPrefs = {
  enabled: boolean;
  /** States to watch (uppercase). Empty = all Australian states. */
  states: string[];
  /** Notify at this severity and above. */
  severityFloor: AlertSeverityFloor;
};

const DEFAULT_PREFS: AlertPrefs = {
  enabled: false,
  states: [],
  severityFloor: "severe",
};

export function readAlertPrefs(): AlertPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AlertPrefs>;
    return {
      enabled: Boolean(parsed.enabled),
      states: Array.isArray(parsed.states)
        ? parsed.states.map((s) => String(s).toUpperCase())
        : [],
      severityFloor:
        parsed.severityFloor === "critical" ? "critical" : "severe",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writeAlertPrefs(prefs: AlertPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent("skywatch:alerts", { detail: prefs }));
  } catch {
    /* ignore */
  }
}

export function subscribeAlertPrefs(cb: (p: AlertPrefs) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = (e: Event) => {
    cb((e as CustomEvent<AlertPrefs>).detail ?? readAlertPrefs());
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === PREFS_KEY) cb(readAlertPrefs());
  };
  window.addEventListener("skywatch:alerts", onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("skywatch:alerts", onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

export function readNotifiedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(NOTIFIED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function markNotified(ids: string[]): void {
  if (typeof window === "undefined" || ids.length === 0) return;
  try {
    const set = readNotifiedIds();
    for (const id of ids) set.add(id);
    // Cap growth — keep newest ~400
    const list = [...set];
    const trimmed = list.length > 400 ? list.slice(list.length - 400) : list;
    window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

export function severityMeetsFloor(
  severity: string,
  floor: AlertSeverityFloor,
): boolean {
  const s = severity.toLowerCase();
  if (s === "critical") return true;
  if (floor === "severe" && s === "severe") return true;
  return false;
}
