"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MAP_REGIONS, type MapRegionId } from "@/components/home/mock-data";
import type { BomRiskDayPublic } from "@/lib/weather/bom-thunderstorm";

type RiskCatalog = {
  days: BomRiskDayPublic[];
};

export function AdminPanel() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [targetDay, setTargetDay] = useState<1 | 2 | 3>(1);
  const [regionId, setRegionId] = useState<MapRegionId>("nsw");
  const [display, setDisplay] = useState<"sheet" | "geo">("sheet");
  const [days, setDays] = useState<BomRiskDayPublic[]>([]);
  const [busyDay, setBusyDay] = useState<number | null>(null);
  const [manageMessage, setManageMessage] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);

  const refreshDays = useCallback(async () => {
    const res = await fetch(`/api/weather/risk?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      setDays([]);
      return;
    }
    const json = (await res.json()) as RiskCatalog;
    setDays(json.days ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json()) as { authenticated: boolean };
        if (!cancelled) {
          setAuthenticated(Boolean(json.authenticated));
          if (json.authenticated) await refreshDays();
        }
      } catch {
        if (!cancelled) setAuthenticated(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [refreshDays]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setLoginError("Incorrect password.");
      return;
    }
    setAuthenticated(true);
    setPassword("");
    await refreshDays();
  }

  async function onLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setDays([]);
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("day", String(targetDay));
      form.append("regionId", regionId);
      form.append("display", display);
      const res = await fetch("/api/admin/risk-upload", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setUploadError(json.error ?? "Upload failed");
        return;
      }
      setUploadMessage(
        `Published Day ${targetDay} BoM chart (${display}, ${regionId.toUpperCase()}).`,
      );
      await refreshDays();
    } catch {
      setUploadError("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function removeDay(day: number) {
    if (!confirm(`Remove Day ${day} BoM thunderstorm chart?`)) return;
    setBusyDay(day);
    setManageError(null);
    setManageMessage(null);
    try {
      const res = await fetch(`/api/admin/risk-upload?day=${day}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setManageError(json.error ?? "Could not remove day");
        return;
      }
      setManageMessage(`Removed Day ${day} chart.`);
      await refreshDays();
    } catch {
      setManageError("Could not remove day");
    } finally {
      setBusyDay(null);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-neutral-400">
        Checking session…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] px-5 py-10 text-[#fafafa] sm:px-8">
      <div className="mx-auto max-w-xl">
        <a
          href="/risk"
          className="text-xs uppercase tracking-[0.22em] text-neutral-500 hover:text-white"
        >
          ← Risk map
        </a>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-white">
          Risk admin
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Upload official BoM thunderstorm forecast graphics for Day 1 (today),
          Day 2 and Day 3. BoM does not publish these charts on a public image
          feed — paste the product sheet issued to emergency services / state
          pages.
        </p>

        {!authenticated ? (
          <Card className="mt-8 border-neutral-800 bg-neutral-950 text-[#fafafa]">
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription className="text-neutral-400">
                Enter the admin password to upload charts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="border-neutral-800 bg-black"
                  />
                </div>
                {loginError && (
                  <p className="text-sm text-red-400">{loginError}</p>
                )}
                <Button type="submit" className="w-full">
                  Sign in
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-8 space-y-6">
            <Card className="border-neutral-800 bg-neutral-950 text-[#fafafa]">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Published days</CardTitle>
                  <CardDescription className="text-neutral-400">
                    Charts currently shown on the public risk map.
                  </CardDescription>
                </div>
                <Button variant="outline" onClick={onLogout}>
                  Log out
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {days.map((d) => (
                    <li
                      key={d.day}
                      className="flex items-center justify-between gap-3 border border-neutral-800 bg-black px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold">{d.label}</p>
                        <p className="text-xs text-neutral-500">
                          {d.available
                            ? `${d.regionId.toUpperCase()} · ${d.display}`
                            : "No chart"}
                        </p>
                      </div>
                      {d.available ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyDay !== null}
                          onClick={() => void removeDay(d.day)}
                          className="border-neutral-700 text-neutral-200 hover:bg-neutral-900"
                        >
                          {busyDay === d.day ? "Removing…" : "Remove"}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {manageMessage && (
                  <p className="text-sm text-emerald-400">{manageMessage}</p>
                )}
                {manageError && (
                  <p className="text-sm text-red-400">{manageError}</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-neutral-800 bg-neutral-950 text-[#fafafa]">
              <CardHeader>
                <CardTitle>Upload BoM chart</CardTitle>
                <CardDescription className="text-neutral-400">
                  PNG or JPEG of the official thunderstorm forecast graphic.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="day">Day</Label>
                    <select
                      id="day"
                      value={targetDay}
                      onChange={(e) =>
                        setTargetDay(Number(e.target.value) as 1 | 2 | 3)
                      }
                      className="flex h-9 w-full rounded-md border border-neutral-800 bg-black px-3 text-sm"
                    >
                      <option value={1}>Day 1 · Today</option>
                      <option value={2}>Day 2</option>
                      <option value={3}>Day 3</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="region">Region</Label>
                    <select
                      id="region"
                      value={regionId}
                      onChange={(e) =>
                        setRegionId(e.target.value as MapRegionId)
                      }
                      className="flex h-9 w-full rounded-md border border-neutral-800 bg-black px-3 text-sm"
                    >
                      {MAP_REGIONS.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.short}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="display">Display</Label>
                    <select
                      id="display"
                      value={display}
                      onChange={(e) =>
                        setDisplay(e.target.value as "sheet" | "geo")
                      }
                      className="flex h-9 w-full rounded-md border border-neutral-800 bg-black px-3 text-sm"
                    >
                      <option value="sheet">Product sheet</option>
                      <option value="geo">Georeferenced</option>
                    </select>
                  </div>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) void uploadFile(file);
                  }}
                  className={
                    dragOver
                      ? "rounded-lg border border-dashed border-cyan-400 bg-cyan-400/10 px-4 py-10 text-center"
                      : "rounded-lg border border-dashed border-neutral-700 bg-black px-4 py-10 text-center"
                  }
                >
                  <p className="text-sm text-neutral-300">
                    Drag & drop a BoM chart image, or choose a file.
                  </p>
                  <Label
                    htmlFor="risk-file"
                    className="mt-4 inline-flex cursor-pointer items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
                  >
                    {uploading ? "Uploading…" : "Choose image"}
                  </Label>
                  <Input
                    id="risk-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadFile(file);
                      e.target.value = "";
                    }}
                  />
                </div>
                {uploadMessage && (
                  <p className="text-sm text-emerald-400">{uploadMessage}</p>
                )}
                {uploadError && (
                  <p className="text-sm text-red-400">{uploadError}</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
