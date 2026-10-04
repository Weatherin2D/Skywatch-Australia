"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { LocationSearch } from "@/components/forecast/location-search";
import { HodographChart } from "@/components/soundings/hodograph";
import { SkewTChart } from "@/components/soundings/skew-t";
import { SoundingParamsTables } from "@/components/soundings/sounding-params";
import { SiteShell } from "@/components/site/site-shell";
import { useSavedPlace } from "@/hooks/use-saved-place";
import type { BomLocation } from "@/lib/weather/location-forecast";
import { SOUNDING_STATIONS } from "@/lib/weather/sounding-stations";
import type {
  SoundingMode,
  SoundingModelId,
  SoundingPayload,
} from "@/lib/weather/sounding-types";
import { cn } from "@/lib/utils";

const MODELS: { id: SoundingModelId; label: string }[] = [
  { id: "pulse", label: "Pulse" },
  { id: "ukmo", label: "UKMO" },
  { id: "ifs", label: "IFS" },
  { id: "access", label: "ACCESS-G" },
];

type Place = { lat: number; lon: number; label: string };

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

export function SoundingsDashboard() {
  const { place: saved, saveFromBomLocation } = useSavedPlace();
  const [mode, setMode] = useState<SoundingMode>("observed");
  const [station, setStation] = useState("94610"); // Perth — often available
  const [model, setModel] = useState<SoundingModelId>("pulse");
  const [place, setPlace] = useState<Place>({
    lat: -31.95,
    lon: 115.86,
    label: "Perth, WA",
  });
  const [parcel, setParcel] = useState<"SFC" | "ML" | "MU">("SFC");
  const [data, setData] = useState<SoundingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelHour, setModelHour] = useState<string>("");

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

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ mode });
        if (mode === "observed") {
          params.set("station", station);
        } else {
          params.set("lat", String(place.lat));
          params.set("lon", String(place.lon));
          params.set("place", place.label);
          params.set("model", model);
          if (modelHour) params.set("time", modelHour);
        }
        const res = await fetch(`/api/weather/sounding?${params}`, {
          cache: "no-store",
          signal,
        });
        if (!res.ok) throw new Error(`Sounding unavailable (${res.status})`);
        const json = (await res.json()) as SoundingPayload;
        if (signal?.aborted) return;
        setData(json);
        setLoading(false);
        if (json.status === "empty") {
          setError(json.message ?? "No sounding available");
        }
      } catch (err) {
        if (signal?.aborted) return;
        setData(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Unavailable");
      }
    },
    [mode, station, place, model, modelHour],
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
      setMode("model");
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
              Observed radiosondes and model Skew-T profiles — thermo, shear,
              and storm-relative diagnostics.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(
                [
                  ["observed", "Observed"],
                  ["model", "Model"],
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
          </div>
        </header>

        <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:flex-row lg:flex-wrap lg:items-center">
          {mode === "observed" ? (
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Radiosonde site
              <select
                value={station}
                onChange={(e) => setStation(e.target.value)}
                className="rounded-xl border border-white/15 bg-[#0b1224] px-3 py-2 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[var(--cyan)]/50"
              >
                {SOUNDING_STATIONS.map((s) => (
                  <option key={s.wmo} value={s.wmo}>
                    {s.name}, {s.state} ({s.wmo})
                  </option>
                ))}
              </select>
            </label>
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

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55">
          <span>
            <span className="text-white/35">Site · </span>
            {data?.stationName ??
              (mode === "observed"
                ? stationMeta
                  ? `${stationMeta.name}, ${stationMeta.state}`
                  : station
                : place.label)}
          </span>
          <span>
            <span className="text-white/35">Valid · </span>
            {formatValid(data?.validTime ?? null)}
          </span>
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

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)_minmax(240px,0.7fr)]">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b16] shadow-[0_0_0_1px_rgba(34,211,238,0.06)]">
            {data && data.levels.length > 0 ? (
              <div className="aspect-[640/720] w-full animate-[fadeIn_0.45s_ease]">
                <SkewTChart
                  levels={data.levels}
                  parcelTraces={data.parcelTraces}
                  activeParcel={parcel}
                />
              </div>
            ) : (
              <div className="flex aspect-[640/720] items-center justify-center px-6 text-center text-sm text-white/50">
                {loading
                  ? "Building Skew-T…"
                  : error || "No profile levels to plot."}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b16]">
              {data && data.levels.length > 0 ? (
                <div className="aspect-square w-full animate-[fadeIn_0.55s_ease]">
                  <HodographChart levels={data.levels} params={data.params} />
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
                  Wind barbs on the right (knots). Hodograph coloured by height
                  AGL; RM/LM = Bunkers storm motion.
                </li>
                <li className="text-white/40">
                  {data?.attribution ??
                    "UWYO observed BUFR · Open-Meteo model levels"}
                </li>
              </ul>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">
            {data ? (
              <SoundingParamsTables params={data.params} />
            ) : (
              <p className="text-sm text-white/45">Parameters load with the profile.</p>
            )}
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
