"use client";

import { useCallback, useEffect, useState } from "react";
import {
  markNotified,
  readAlertPrefs,
  readNotifiedIds,
  severityMeetsFloor,
  subscribeAlertPrefs,
  writeAlertPrefs,
  type AlertPrefs,
} from "@/lib/prefs/alerts";
import type { BomWarningSummary } from "@/lib/weather/warnings";

async function fetchWarnings(): Promise<BomWarningSummary[]> {
  const res = await fetch("/api/weather/warnings");
  if (!res.ok) return [];
  const json = (await res.json()) as { warnings?: BomWarningSummary[] };
  return json.warnings ?? [];
}

function matchesStates(w: BomWarningSummary, states: string[]): boolean {
  if (states.length === 0) return true;
  const want = new Set(states.map((s) => s.toUpperCase()));
  return w.states.some((s) => want.has(s.toUpperCase()));
}

export function useWarningAlerts(pollMs = 180_000) {
  const [prefs, setPrefs] = useState<AlertPrefs>(() => ({
    enabled: false,
    states: [],
    severityFloor: "severe",
  }));
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPrefs(readAlertPrefs());
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
    }
    setReady(true);
    return subscribeAlertPrefs(setPrefs);
  }, []);

  const savePrefs = useCallback((next: AlertPrefs) => {
    writeAlertPrefs(next);
    setPrefs(next);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") {
      throw new Error("Notifications are not supported in this browser.");
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const scan = useCallback(async () => {
    const current = readAlertPrefs();
    if (!current.enabled) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const notified = readNotifiedIds();
    const fresh: BomWarningSummary[] = [];

    const warnings = await fetchWarnings();
    for (const w of warnings) {
      if (w.severity === "cancelled") continue;
      if (!severityMeetsFloor(w.severity, current.severityFloor)) continue;
      if (!matchesStates(w, current.states)) continue;
      if (notified.has(w.id)) continue;
      fresh.push(w);
    }

    if (fresh.length) {
      markNotified(fresh.map((w) => w.id));
      for (const w of fresh.slice(0, 5)) {
        const title = `${w.severity.toUpperCase()}: ${w.shortTitle}`;
        const body = `${w.states.join(", ") || w.state} — ${w.title}`;
        try {
          const n = new Notification(title, {
            body,
            tag: `skywatch-warn-${w.id}`,
            icon: "/icon",
          });
          n.onclick = () => {
            window.focus();
            window.location.href = w.href;
            n.close();
          };
        } catch {
          /* ignore */
        }
      }
    }

    // Also notify on new CloudCountry automated thunderstorm cells (Watch/Warning).
    try {
      const res = await fetch("/api/weather/storm-cells", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        alerts?: {
          id: string;
          score: number;
          alertLevel: "watch" | "warning";
          label: string;
          summary: string;
          href: string;
        }[];
      };
      const alerts = json.alerts ?? [];
      const freshCells = alerts.filter((a) => {
        if (notified.has(`auto:${a.id}`)) return false;
        // Map floor: severe → watch+, critical → warning only.
        if (current.severityFloor === "critical") {
          return a.alertLevel === "warning";
        }
        return true;
      });
      if (!freshCells.length) return;
      markNotified(freshCells.map((a) => `auto:${a.id}`));
      for (const a of freshCells.slice(0, 3)) {
        try {
          const n = new Notification(
            `CloudCountry ${a.alertLevel.toUpperCase()}: ${a.label}`,
            {
              body: a.summary,
              tag: `skywatch-auto-${a.id}`,
              icon: "/icon",
            },
          );
          n.onclick = () => {
            window.focus();
            window.location.href = a.href;
            n.close();
          };
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore automated scan failures */
    }
  }, []);

  useEffect(() => {
    if (!ready || !prefs.enabled) return;
    void scan();
    const id = window.setInterval(() => void scan(), pollMs);
    const onFocus = () => void scan();
    const onVis = () => {
      if (document.visibilityState === "visible") void scan();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ready, prefs.enabled, prefs.states, prefs.severityFloor, pollMs, scan]);

  return {
    prefs,
    permission,
    ready,
    savePrefs,
    requestPermission,
    scanNow: scan,
  };
}
