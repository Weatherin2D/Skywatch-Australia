"use client";

import { Bell, BellOff } from "lucide-react";
import { useWarningAlerts } from "@/hooks/use-warning-alerts";
import type { AlertSeverityFloor } from "@/lib/prefs/alerts";
import { cn } from "@/lib/utils";

const STATE_OPTIONS = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT", "ACT"];

export function WarningAlertSettings() {
  const { prefs, permission, ready, savePrefs, requestPermission } =
    useWarningAlerts();

  if (!ready) return null;

  async function enableAlerts() {
    try {
      const perm = await requestPermission();
      if (perm !== "granted") {
        savePrefs({ ...prefs, enabled: false });
        return;
      }
      savePrefs({ ...prefs, enabled: true });
    } catch {
      savePrefs({ ...prefs, enabled: false });
    }
  }

  function toggleState(state: string) {
    const upper = state.toUpperCase();
    const has = prefs.states.includes(upper);
    const states = has
      ? prefs.states.filter((s) => s !== upper)
      : [...prefs.states, upper];
    savePrefs({ ...prefs, states });
  }

  return (
    <section className="sw-panel mb-5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
            {prefs.enabled ? (
              <Bell className="h-4 w-4" aria-hidden />
            ) : (
              <BellOff className="h-4 w-4" aria-hidden />
            )}
            Browser alerts
          </h2>
          <p className="mt-1 max-w-xl text-xs text-white/65">
            Get a notification when a new BoM Critical/Severe warning appears
            for your selected states, and when SkyWatch raises an Automated
            thunderstorm Watch/Warning. Stored only on this device — no account
            or email.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (prefs.enabled) {
              savePrefs({ ...prefs, enabled: false });
            } else {
              void enableAlerts();
            }
          }}
          className={cn(
            "sw-chip",
            prefs.enabled ? "sw-chip-active" : "sw-chip-idle",
          )}
        >
          {prefs.enabled ? "Alerts on" : "Enable alerts"}
        </button>
      </div>

      {permission === "denied" ? (
        <p className="mt-3 text-xs text-amber-200/90">
          Notifications are blocked in this browser. Allow them in site settings
          to receive alerts.
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
            Minimum severity
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["severe", "Severe + Critical"],
                ["critical", "Critical only"],
              ] as [AlertSeverityFloor, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => savePrefs({ ...prefs, severityFloor: id })}
                className={cn(
                  "sw-chip",
                  prefs.severityFloor === id ? "sw-chip-active" : "sw-chip-idle",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
            States (none = all)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STATE_OPTIONS.map((s) => {
              const on =
                prefs.states.length === 0 || prefs.states.includes(s);
              const explicit = prefs.states.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleState(s)}
                  className={cn(
                    "sw-chip",
                    explicit || prefs.states.length === 0
                      ? "sw-chip-active"
                      : "sw-chip-idle",
                    prefs.states.length === 0 && "opacity-70",
                  )}
                  aria-pressed={on}
                >
                  {s}
                </button>
              );
            })}
          </div>
          {prefs.states.length === 0 ? (
            <p className="mt-1.5 text-[10px] text-white/45">
              Watching all states. Tap a state to narrow the list.
            </p>
          ) : (
            <button
              type="button"
              className="mt-1.5 text-[10px] font-semibold text-[var(--cyan)] hover:underline"
              onClick={() => savePrefs({ ...prefs, states: [] })}
            >
              Clear → watch all states
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
