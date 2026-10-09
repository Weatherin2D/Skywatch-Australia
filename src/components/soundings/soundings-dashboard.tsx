"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { LocationSearch } from "@/components/forecast/location-search";
import { HodographChart } from "@/components/soundings/hodograph";
import { SkewTChart } from "@/components/soundings/skew-t";
import { SoundingBoxGrid } from "@/components/soundings/sounding-box-grid";
import { SoundingLocationMapDynamic } from "@/components/soundings/sounding-location-map-dynamic";
import { SoundingParamsTables } from "@/components/soundings/sounding-params";
import { SiteShell } from "@/components/site/site-shell";
import { EngineModeToggle } from "@/components/weather/engine-mode-toggle";
import { useSavedPlace } from "@/hooks/use-saved-place";
import type { BomLocation } from "@/lib/weather/location-forecast";
import {
  parseEngineUiMode,
  type EngineUiMode,
} from "@/lib/weather/engine-mode";
import { SOUNDING_STATIONS } from "@/lib/weather/sounding-stations";
import type {
  SoundingBoxPayload,
  SoundingBoxSpacingDeg,
  SoundingMode,
  SoundingModelId,
  SoundingPayload,
} from "@/lib/weather/sounding-types";
import type { ObservedArchiveSlot } from "@/lib/weather/uwyo-sounding";
import { cn } from "@/lib/utils";

const MODELS: { id: SoundingModelId; label: string }[] = [
  { id: "pulse", label: "Pulse" },
  { id: "ukmo", label: "UKMO" },
  { id: "ifs", label: "IFS" },
  { id: "access", label: "ACCESS-G" },
];

const BOX_SPACING: { id: SoundingBoxSpacingDeg; label: string }[] = [
  { id: 0.25, label: "±0.25°" },
  { id: 0.5, label: "±0.5°" },
  { id: 1, label: "±1.0°" },
];

type Place = { lat: number; lon: number; label: string };

type ArchiveCatalog = {
  stationId: string;
  stationName: string;
  years: number[];
  slots: ObservedArchiveSlot[];
  attribution?: string;
};

function formatValid(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d) + " UTC";
}

function formatHourChip(hour: number): string {
  return `${String(hour).padStart(2, "0")}Z`;
}

function readSoundingsQuery(): {
  mode: SoundingMode;
  engine: EngineUiMode;
  model: SoundingModelId;
  lat: number;
  lon: number;
  place: string;
} {
  const fallback = {
    mode: "model" as SoundingMode,
    engine: "predict" as EngineUiMode,
    model: "pulse" as SoundingModelId,
    lat: -31.95,
    lon: 115.86,
    place: "Perth, WA",
  };
  if (typeof window === "undefined") return fallback;
  const sp = new URLSearchParams(window.location.search);
  const modeRaw = (sp.get("mode") || "model").toLowerCase();
  const mode: SoundingMode =
    modeRaw === "observed" || modeRaw === "box" || modeRaw === "model"
      ? modeRaw
      : "model";
  const modelRaw = (sp.get("model") || "pulse").toLowerCase();
  const model: SoundingModelId = MODELS.some((m) => m.id === modelRaw)
    ? (modelRaw as SoundingModelId)
    : "pulse";
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  return {
    mode,
    engine: parseEngineUiMode(sp.get("engine") || "predict"),
    model,
    lat: Number.isFinite(lat) ? lat : fallback.lat,
    lon: Number.isFinite(lon) ? lon : fallback.lon,
    place: sp.get("place") || fallback.place,
  };
}

export function SoundingsDashboard() {
  const { place: saved, saveFromBomLocation } = useSavedPlace();
  const initial = useMemo(() => readSoundingsQuery(), []);
  // Default Model + AI V1 — Observed depends on UWYO which often times out.
  const [mode, setMode] = useState<SoundingMode>(initial.mode);
  const [engineMode, setEngineMode] = useState<EngineUiMode>(initial.engine);
  const [station, setStation] = useState("94610"); // Perth — often available
  const [model, setModel] = useState<SoundingModelId>(initial.model);
  const [place, setPlace] = useState<Place>({
    lat: initial.lat,
    lon: initial.lon,
    label: initial.place,
  });
  const [parcel, setParcel] = useState<"SFC" | "ML" | "MU">("SFC");
  const [data, setData] = useState<SoundingPayload | null>(null);
  const [boxData, setBoxData] = useState<SoundingBoxPayload | null>(null);
  const [boxSpacing, setBoxSpacing] = useState<SoundingBoxSpacingDeg>(0.5);
  const [boxSelected, setBoxSelected] = useState("1-1"); // centre
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelHour, setModelHour] = useState<string>("");
  /** null = latest available; ISO = specific UWYO archive slot */
  const [observedTime, setObservedTime] = useState<string | null>(null);
  const [archive, setArchive] = useState<ArchiveCatalog | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveYear, setArchiveYear] = useState<number>(
    () => new Date().getUTCFullYear(),
  );
  const [archiveDate, setArchiveDate] = useState<string>("");

  // Keep shareable URL in sync with Model / AI V1 controls.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== "/soundings") return;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    url.searchParams.set("engine", engineMode);
    if (mode === "observed") {
      url.searchParams.delete("model");
      url.searchParams.delete("lat");
      url.searchParams.delete("lon");
      url.searchParams.delete("place");
    } else {
      url.searchParams.set("model", model);
      url.searchParams.set("lat", place.lat.toFixed(3));
      url.searchParams.set("lon", place.lon.toFixed(3));
      url.searchParams.set("place", place.label);
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}`,
    );
  }, [mode, engineMode, model, place]);

  useEffect(() => {
    if (!saved) return;
    setPlace({
      lat: saved.lat,
      lon: saved.lon,
      label: `${saved.name}, ${saved.state}`,
    });
  }, [saved]);

  const modelHours = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    for (let i = 0; i < 48; i++) {
      out.push(new Date(now.getTime() + i * 3_600_000).toISOString());
    }
    return out;
  }, []);

  useEffect(() => {
    if (!modelHour && modelHours[0]) setModelHour(modelHours[0]!);
  }, [modelHour, modelHours]);

  const archiveYears = useMemo(() => {
    const y = new Date().getUTCFullYear();
    return [y, y - 1, y - 2];
  }, []);

  const slotsForYear = useMemo(() => {
    if (!archive) return [];
    return archive.slots.filter((s) => s.date.startsWith(String(archiveYear)));
  }, [archive, archiveYear]);

  const datesForYear = useMemo(() => {
    const dates: string[] = [];
    const seen = new Set<string>();
    for (const s of slotsForYear) {
      if (seen.has(s.date)) continue;
      seen.add(s.date);
      dates.push(s.date);
    }
    return dates;
  }, [slotsForYear]);

  const hoursForDate = useMemo(() => {
    if (!archiveDate) return [];
    return slotsForYear.filter((s) => s.date === archiveDate);
  }, [slotsForYear, archiveDate]);

  const recentSlots = useMemo(() => slotsForYear.slice(0, 14), [slotsForYear]);

  const activeSlotIndex = useMemo(() => {
    if (!observedTime || !archive) return -1;
    return archive.slots.findIndex((s) => s.time === observedTime);
  }, [archive, observedTime]);

  useEffect(() => {
    if (mode !== "observed") return;
    const ac = new AbortController();
    setArchiveLoading(true);
    const years = archiveYears.join(",");
    const timeout = AbortSignal.timeout(25_000);
    const combined =
      typeof AbortSignal.any === "function"
        ? AbortSignal.any([ac.signal, timeout])
        : ac.signal;
    void fetch(
      `/api/weather/sounding?archive=1&station=${encodeURIComponent(station)}&year=${years}`,
      { cache: "no-store", signal: combined },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`Archive unavailable (${res.status})`);
        return (await res.json()) as ArchiveCatalog;
      })
      .then((catalog) => {
        if (ac.signal.aborted) return;
        setArchive(catalog);
        setArchiveLoading(false);
        const yearSlots = catalog.slots.filter((s) =>
          s.date.startsWith(String(archiveYear)),
        );
        const fallbackYear = catalog.slots[0]?.date.slice(0, 4);
        if (
          yearSlots.length === 0 &&
          fallbackYear &&
          Number(fallbackYear) !== archiveYear
        ) {
          setArchiveYear(Number(fallbackYear));
        }
        if (!archiveDate && catalog.slots[0]) {
          setArchiveDate(catalog.slots[0].date);
        }
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setArchive(null);
        setArchiveLoading(false);
        console.warn("[soundings archive]", err);
      });
    return () => ac.abort();
    // archiveDate / archiveYear intentionally omitted — seed date from catalog once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, station, archiveYears]);

  // Keep date selector aligned with the active archive slot.
  useEffect(() => {
    if (!observedTime || !archive) return;
    const slot = archive.slots.find((s) => s.time === observedTime);
    if (!slot) return;
    if (slot.date !== archiveDate) setArchiveDate(slot.date);
    const y = Number(slot.date.slice(0, 4));
    if (Number.isFinite(y) && y !== archiveYear) setArchiveYear(y);
  }, [observedTime, archive, archiveDate, archiveYear]);

  const selectedBoxCell = useMemo(() => {
    if (!boxData) return null;
    return (
      boxData.cells.find((c) => `${c.row}-${c.col}` === boxSelected) ??
      boxData.cells.find((c) => c.row === 1 && c.col === 1) ??
      boxData.cells[0] ??
      null
    );
  }, [boxData, boxSelected]);

  const activeSounding: SoundingPayload | null =
    mode === "box" ? (selectedBoxCell?.sounding ?? null) : data;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ mode, engine: engineMode });
        if (mode === "observed") {
          params.set("station", station);
          if (observedTime) params.set("time", observedTime);
        } else {
          params.set("lat", String(place.lat));
          params.set("lon", String(place.lon));
          params.set("place", place.label);
          params.set("model", model);
          if (modelHour) params.set("time", modelHour);
          if (mode === "box") params.set("spacing", String(boxSpacing));
        }
        const timeout = AbortSignal.timeout(55_000);
        const combined =
          typeof AbortSignal.any === "function" && signal
            ? AbortSignal.any([signal, timeout])
            : (signal ?? timeout);
        const res = await fetch(`/api/weather/sounding?${params}`, {
          cache: "no-store",
          signal: combined,
        });
        if (!res.ok) throw new Error(`Sounding unavailable (${res.status})`);
        const json = (await res.json()) as SoundingPayload | SoundingBoxPayload;
        if (signal?.aborted) return;
        if (mode === "box") {
          const box = json as SoundingBoxPayload;
          setBoxData(box);
          setData(null);
          setBoxSelected((prev) => {
            if (box.cells.some((c) => `${c.row}-${c.col}` === prev)) return prev;
            return "1-1";
          });
          setLoading(false);
          if (box.status === "empty") {
            setError(box.message ?? "No box soundings available");
          }
        } else {
          const single = json as SoundingPayload;
          setData(single);
          setBoxData(null);
          setLoading(false);
          if (single.status === "empty") {
            setError(single.message ?? "No sounding available");
          }
        }
      } catch (err) {
        if (signal?.aborted) return;
        setData(null);
        setBoxData(null);
        setLoading(false);
        const msg = err instanceof Error ? err.message : "Unavailable";
        const timedOut = /aborted|timeout|TimeoutError/i.test(msg);
        setError(
          timedOut
            ? mode === "observed"
              ? "Observed radiosonde timed out (UWYO). Switch to Model and use Engine or AI V1."
              : "Sounding request timed out — try again or switch engine"
            : msg,
        );
      }
    },
    [mode, engineMode, station, place, model, modelHour, observedTime, boxSpacing],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  async function selectBomLocation(loc: BomLocation) {
    try {
      const savedPlace = await saveFromBomLocation(loc);
      setPlace({
        lat: savedPlace.lat,
        lon: savedPlace.lon,
        label: `${savedPlace.name}, ${savedPlace.state}`,
      });
      if (mode === "observed") setMode("model");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Location unavailable");
    }
  }

  const stationMeta = SOUNDING_STATIONS.find((s) => s.wmo === station);

  return (
    <SiteShell mainClassName="!pb-4">
      <div className="flex flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cyan)]">
              SkyWatch Australia
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Soundings
            </h1>
            <p className="mt-1 max-w-xl text-sm text-white/55">
              Observed radiosondes, single-point model Skew-Ts, and 3×3 model
              sounding boxes. Thermo via SkyWatch AI engine, or AI V1 neural
              residual (AU ETL + Open-Meteo teacher — local sidecar).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(
                [
                  ["observed", "Observed"],
                  ["model", "Model"],
                  ["box", "Box"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    mode === id
                      ? "bg-[var(--cyan)] text-[#070b16]"
                      : "text-white/65 hover:text-white",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <EngineModeToggle value={engineMode} onChange={setEngineMode} />
          </div>
        </header>

        <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:flex-row lg:flex-wrap lg:items-center">
          {mode === "observed" ? (
            <>
              <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                Radiosonde site
                <select
                  value={station}
                  onChange={(e) => {
                    setStation(e.target.value);
                    setObservedTime(null);
                    setArchiveDate("");
                  }}
                  className="rounded-xl border border-white/15 bg-[#0b1224] px-3 py-2 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[var(--cyan)]/50"
                >
                  {SOUNDING_STATIONS.map((s) => (
                    <option key={s.wmo} value={s.wmo}>
                      {s.name}, {s.state} ({s.wmo})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setObservedTime(null)}
                className={cn(
                  "self-end rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-wide transition",
                  observedTime == null
                    ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/15 text-[var(--cyan)]"
                    : "border-white/15 text-white/60 hover:text-white",
                )}
              >
                Latest
              </button>
            </>
          ) : (
            <>
              <div className="min-w-[220px] flex-1">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  Location
                </p>
                <LocationSearch
                  compact
                  initialQuery={place.label}
                  onSelect={selectBomLocation}
                />
              </div>
              <label className="flex min-w-[140px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                Model
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as SoundingModelId)}
                  className="rounded-xl border border-white/15 bg-[#0b1224] px-3 py-2 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[var(--cyan)]/50"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[180px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                Valid time (UTC)
                <select
                  value={modelHour}
                  onChange={(e) => setModelHour(e.target.value)}
                  className="rounded-xl border border-white/15 bg-[#0b1224] px-3 py-2 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[var(--cyan)]/50"
                >
                  {modelHours.map((h) => (
                    <option key={h} value={h}>
                      {formatValid(h)}
                    </option>
                  ))}
                </select>
              </label>
              {mode === "box" ? (
                <label className="flex min-w-[120px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  Box spacing
                  <select
                    value={boxSpacing}
                    onChange={(e) =>
                      setBoxSpacing(Number(e.target.value) as SoundingBoxSpacingDeg)
                    }
                    className="rounded-xl border border-white/15 bg-[#0b1224] px-3 py-2 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[var(--cyan)]/50"
                  >
                    {BOX_SPACING.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          )}

          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <div className="inline-flex rounded-xl border border-white/10 p-1">
              {(["SFC", "ML", "MU"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setParcel(id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-bold transition",
                    parcel === id
                      ? "bg-amber-400/20 text-amber-200"
                      : "text-white/50 hover:text-white",
                  )}
                >
                  {id}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl border border-[var(--cyan)]/40 bg-[var(--cyan)]/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--cyan)] transition hover:bg-[var(--cyan)]/20"
            >
              Refresh
            </button>
          </div>
        </div>

        {mode === "observed" ? (
          <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-white">
                Observed archive
              </p>
              <span className="text-[11px] text-white/40">
                UWYO BUFR inventory · {archive?.slots.length ?? "—"} launches
              </span>
              {archiveLoading ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--cyan)]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading catalog…
                </span>
              ) : null}
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={activeSlotIndex < 0 || activeSlotIndex >= (archive?.slots.length ?? 0) - 1}
                  onClick={() => {
                    if (!archive || activeSlotIndex < 0) return;
                    const next = archive.slots[activeSlotIndex + 1];
                    if (next) setObservedTime(next.time);
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/15 px-2 text-xs font-semibold text-white/70 transition hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)] disabled:opacity-35"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Older
                </button>
                <button
                  type="button"
                  disabled={activeSlotIndex <= 0}
                  onClick={() => {
                    if (!archive || activeSlotIndex <= 0) return;
                    const next = archive.slots[activeSlotIndex - 1];
                    if (next) setObservedTime(next.time);
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/15 px-2 text-xs font-semibold text-white/70 transition hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)] disabled:opacity-35"
                >
                  Newer
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-[100px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                Year
                <select
                  value={archiveYear}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setArchiveYear(y);
                    setArchiveDate("");
                  }}
                  className="rounded-xl border border-white/15 bg-[#0b1224] px-3 py-2 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[var(--cyan)]/50"
                >
                  {archiveYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                Date (UTC)
                <select
                  value={archiveDate}
                  onChange={(e) => {
                    const date = e.target.value;
                    setArchiveDate(date);
                    const first = slotsForYear.find((s) => s.date === date);
                    if (first) setObservedTime(first.time);
                  }}
                  disabled={!datesForYear.length}
                  className="rounded-xl border border-white/15 bg-[#0b1224] px-3 py-2 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[var(--cyan)]/50 disabled:opacity-40"
                >
                  {datesForYear.length === 0 ? (
                    <option value="">No launches</option>
                  ) : (
                    datesForYear.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  Launch
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {hoursForDate.length === 0 ? (
                    <span className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/40">
                      —
                    </span>
                  ) : (
                    hoursForDate.map((s) => (
                      <button
                        key={s.time}
                        type="button"
                        onClick={() => setObservedTime(s.time)}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-xs font-bold transition",
                          observedTime === s.time
                            ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/15 text-[var(--cyan)]"
                            : "border-white/10 text-white/65 hover:text-white",
                        )}
                      >
                        {formatHourChip(s.hour)}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {recentSlots.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  onClick={() => setObservedTime(s.time)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                    observedTime === s.time
                      ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/15 text-[var(--cyan)]"
                      : "border-white/10 text-white/55 hover:text-white",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55">
          <span>
            <span className="text-white/35">Site · </span>
            {mode === "box"
              ? selectedBoxCell?.sounding.stationName ?? place.label
              : (activeSounding?.stationName ??
                (mode === "observed"
                  ? stationMeta
                    ? `${stationMeta.name}, ${stationMeta.state}`
                    : station
                  : place.label))}
          </span>
          {mode === "model" || mode === "box" ? (
            <span>
              <span className="text-white/35">Point · </span>
              {place.lat.toFixed(2)}°, {place.lon.toFixed(2)}°
              {mode === "box" ? ` · box ±${boxSpacing}°` : ""}
            </span>
          ) : null}
          <span>
            <span className="text-white/35">Valid · </span>
            {formatValid(
              mode === "box"
                ? (boxData?.validTime ?? null)
                : (activeSounding?.validTime ?? null),
            )}
          </span>
          {mode === "observed" ? (
            <span>
              <span className="text-white/35">Archive · </span>
              {observedTime == null ? "Latest" : formatValid(observedTime)}
            </span>
          ) : null}
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--cyan)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading sounding…
            </span>
          ) : null}
          {error && !loading ? (
            <span className="text-amber-300/90">{error}</span>
          ) : null}
        </div>

        {mode === "model" || mode === "box" ? (
          <SoundingLocationMapDynamic
            place={place}
            onPick={(next) => {
              setPlace(next);
            }}
          />
        ) : null}

        {mode === "box" && boxData ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <SoundingBoxGrid
              box={boxData}
              selectedKey={boxSelected}
              activeParcel={parcel}
              onSelect={(row, col) => setBoxSelected(`${row}-${col}`)}
            />
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)_minmax(240px,0.7fr)]">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b16] shadow-[0_0_0_1px_rgba(34,211,238,0.06)]">
            {activeSounding && activeSounding.levels.length > 0 ? (
              <div className="aspect-[640/720] w-full animate-[fadeIn_0.45s_ease]">
                <SkewTChart
                  levels={activeSounding.levels}
                  parcelTraces={activeSounding.parcelTraces}
                  activeParcel={parcel}
                />
              </div>
            ) : (
              <div className="flex aspect-[640/720] items-center justify-center px-6 text-center text-sm text-white/50">
                {loading
                  ? mode === "box"
                    ? "Building sounding box…"
                    : "Building Skew-T…"
                  : error || "No profile levels to plot."}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b16]">
              {activeSounding && activeSounding.levels.length > 0 ? (
                <div className="aspect-square w-full animate-[fadeIn_0.55s_ease]">
                  <HodographChart
                    levels={activeSounding.levels}
                    params={activeSounding.params}
                  />
                </div>
              ) : (
                <div className="flex aspect-square items-center justify-center text-sm text-white/45">
                  Hodograph waiting on profile
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/60">
              <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-white">
                Readout
              </p>
              <ul className="mt-2 space-y-1.5">
                <li>
                  Temp (red) · Dewpoint (green) · {parcel} parcel (gold dash)
                </li>
                <li>
                  {mode === "box"
                    ? "Box cells are north-up. Click a cell to inspect full Skew-T, hodograph, and params."
                    : "Wind barbs on the right (knots). Hodograph coloured by height AGL; RM/LM = Bunkers storm motion."}
                </li>
                <li className="text-white/40">
                  {activeSounding?.attribution ??
                    boxData?.attribution ??
                    "UWYO observed BUFR · Open-Meteo model levels"}
                </li>
              </ul>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">
            {activeSounding ? (
              <SoundingParamsTables
                params={activeSounding.params}
                engine={activeSounding.engine ?? "legacy"}
                engineHemisphere={activeSounding.engineHemisphere}
                engineMessage={activeSounding.engineMessage}
              />
            ) : (
              <p className="text-sm text-white/45">Parameters load with the profile.</p>
            )}
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
