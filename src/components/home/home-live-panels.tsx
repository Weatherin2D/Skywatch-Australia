"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LocateFixed, MapPin } from "lucide-react";
import { WeatherIcon } from "@/components/forecast/weather-icon";
import { LocationSearch } from "@/components/forecast/location-search";
import { useCapitals } from "@/hooks/use-capitals";
import { useLocationForecast } from "@/hooks/use-location-forecast";
import { useSavedPlace } from "@/hooks/use-saved-place";
import {
  STATE_CAPITALS,
  formatClockLabel,
  formatDateHeading,
  rainLabel,
  type LocationForecastPayload,
} from "@/lib/weather/location-forecast";
import type { SavedPlace } from "@/lib/prefs/location";

const FALLBACK = STATE_CAPITALS.nsw;

type PlaceCtx = {
  place: SavedPlace | null;
  ready: boolean;
  geohash: string;
  label: string;
  forecast: LocationForecastPayload | null;
  loading: boolean;
  error: string | null;
  saveFromGeolocation: () => Promise<SavedPlace>;
  saveFromBomLocation: (
    loc: Parameters<
      ReturnType<typeof useSavedPlace>["saveFromBomLocation"]
    >[0],
  ) => Promise<SavedPlace>;
};

const HomePlaceContext = createContext<PlaceCtx | null>(null);

export function HomePlaceProvider({ children }: { children: React.ReactNode }) {
  const {
    place,
    ready,
    saveFromBomLocation,
    saveFromGeolocation,
  } = useSavedPlace();
  const geohash = place?.geohash || FALLBACK.geohash;
  const { forecast, loading, error } = useLocationForecast(geohash);
  const label = place
    ? `${place.name}, ${place.state}`
    : `${FALLBACK.name}, ${FALLBACK.state}`;

  const value = useMemo(
    () => ({
      place,
      ready,
      geohash,
      label,
      forecast,
      loading,
      error,
      saveFromGeolocation,
      saveFromBomLocation,
    }),
    [
      place,
      ready,
      geohash,
      label,
      forecast,
      loading,
      error,
      saveFromGeolocation,
      saveFromBomLocation,
    ],
  );

  return (
    <HomePlaceContext.Provider value={value}>
      {children}
    </HomePlaceContext.Provider>
  );
}

/** @deprecated Use HomePlaceProvider */
export const HomeSydneyForecastProvider = HomePlaceProvider;

function useHomePlace() {
  const ctx = useContext(HomePlaceContext);
  if (!ctx) {
    throw new Error("Home place panels require HomePlaceProvider");
  }
  return ctx;
}

export function useHomeSavedPlace() {
  return useHomePlace();
}

export function HomeDateHeading() {
  const { forecast } = useHomePlace();
  const tz = forecast?.location.timezone || "Australia/Sydney";
  return <>{formatDateHeading(tz)}</>;
}

function PlaceControls() {
  const { saveFromBomLocation, saveFromGeolocation, place, ready } =
    useHomePlace();
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={geoBusy}
          onClick={() => {
            setGeoBusy(true);
            setGeoError(null);
            void saveFromGeolocation()
              .catch((err) =>
                setGeoError(
                  err instanceof Error ? err.message : "Location failed",
                ),
              )
              .finally(() => setGeoBusy(false));
          }}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--ink)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--ink)]/18 disabled:opacity-50"
        >
          <LocateFixed className="h-3 w-3" aria-hidden />
          {geoBusy ? "Locating…" : "Use my location"}
        </button>
        <button
          type="button"
          onClick={() => setShowSearch((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--ink)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--ink)]/18"
        >
          <MapPin className="h-3 w-3" aria-hidden />
          {showSearch ? "Hide search" : "Change place"}
        </button>
      </div>
      {ready && !place ? (
        <p className="text-[10px] text-[var(--ink)]/60">
          Showing Sydney until you set a place.
        </p>
      ) : null}
      {geoError ? (
        <p className="text-[10px] text-amber-200/90">{geoError}</p>
      ) : null}
      {showSearch ? (
        <LocationSearch
          className="w-full"
          onSelect={(loc) => {
            void saveFromBomLocation(loc).then(() => setShowSearch(false));
          }}
        />
      ) : null}
    </div>
  );
}

export function HomeNowPanel() {
  const { forecast, loading, error, geohash, label } = useHomePlace();
  const loc = forecast?.location;
  const obs = forecast?.observation;
  const today = forecast?.daily[0] ?? null;
  const tz = loc?.timezone || "Australia/Sydney";

  const temp =
    obs?.temp != null
      ? Math.round(obs.temp)
      : today?.tempNow != null
        ? Math.round(today.tempNow)
        : null;

  const place = loc ? `${loc.name}, ${loc.state}` : label;
  const clock = formatClockLabel(obs?.observationTime ?? null, tz);
  const condition = today?.shortText || (loading ? "Loading…" : "—");

  return (
    <section className="sw-panel p-3.5 text-[var(--ink)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/forecast/${geohash}`}
            className="block truncate text-base font-bold text-[var(--ink)] hover:underline sm:text-lg"
          >
            {place}
          </Link>
          <p className="text-xs text-[var(--ink)]/65">
            {loading && !forecast ? "Updating…" : clock}
          </p>
        </div>
        <WeatherIcon
          icon={today?.icon || "mostly_sunny"}
          night={today?.isNight}
          className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
        />
      </div>

      <PlaceControls />

      {error && !forecast ? (
        <p className="mt-2 text-sm text-white/75">{error}</p>
      ) : (
        <>
          <div className="mt-2 flex items-end gap-2">
            <p className="text-4xl font-bold leading-none text-[var(--ink)]">
              {temp != null ? `${temp}°` : "—"}
            </p>
            <p className="pb-1 text-sm text-[var(--ink)]/80">{condition}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
            {[
              [
                "Feels like",
                obs?.tempFeelsLike != null
                  ? `${Math.round(obs.tempFeelsLike)}°`
                  : "—",
              ],
              [
                "Humidity",
                obs?.humidity != null ? `${Math.round(obs.humidity)}%` : "—",
              ],
              [
                "Wind",
                obs?.windKmh != null
                  ? `${obs.windDir || ""} ${Math.round(obs.windKmh)} km/h`.trim()
                  : "—",
              ],
              [
                "Rain since 9am",
                obs?.rainSince9am != null ? `${obs.rainSince9am} mm` : "—",
              ],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded-md bg-[var(--ink)]/8 px-2 py-1.5"
              >
                <p className="text-[10px] uppercase tracking-wide text-[var(--ink)]/60">
                  {k}
                </p>
                <p className="font-bold text-[var(--ink)]">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--ink)]/12 pt-2 text-xs text-[var(--ink)]/85">
            <span>
              Min{" "}
              <strong className="text-[var(--ink)]">
                {today?.tempMin != null ? `${today.tempMin}°` : "—"}
              </strong>
            </span>
            <span>
              Max{" "}
              <strong className="text-[var(--cyan)]">
                {today?.tempMax != null ? `${today.tempMax}°` : "—"}
              </strong>
            </span>
            <span>
              Rain{" "}
              <strong className="text-[var(--ink)]">
                {rainLabel(
                  today?.rainChance ?? null,
                  today?.rainMinMm ?? null,
                  today?.rainMaxMm ?? null,
                )}
              </strong>
            </span>
            {today?.uvMaxIndex != null ? (
              <span>
                UV{" "}
                <strong className="text-[var(--ink)]">
                  {today.uvMaxIndex}
                  {today.uvCategory ? ` ${today.uvCategory}` : ""}
                </strong>
              </span>
            ) : null}
          </div>
          <Link
            href={`/forecast/${geohash}`}
            className="mt-2 inline-block text-xs font-semibold text-[var(--cyan)] hover:underline"
          >
            Full forecast →
          </Link>
        </>
      )}
    </section>
  );
}

export function HomeCapitalsPanel() {
  const { capitals, loading, error } = useCapitals();
  const heading = formatDateHeading("Australia/Sydney");

  return (
    <section className="sw-panel p-3 text-[var(--ink)] sm:p-3.5">
      <h2 className="sw-panel-title">Capital cities — {heading}</h2>
      {loading && capitals.length === 0 ? (
        <p className="text-sm text-white/70">Loading capital weather…</p>
      ) : null}
      {error && capitals.length === 0 ? (
        <p className="text-sm text-white/80">{error}</p>
      ) : null}
      {capitals.length > 0 ? (
        <div className="sw-chip-row sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-8 [&::-webkit-scrollbar]:hidden">
          {capitals.map((c) => (
            <Link
              key={c.geohash}
              href={c.href}
              className="w-[7.5rem] shrink-0 rounded-md bg-[var(--ink)]/8 px-2.5 py-2.5 text-center transition hover:bg-[var(--ink)]/15 sm:w-auto"
            >
              <p className="text-xs font-bold text-[var(--ink)]">{c.city}</p>
              <div className="my-1 flex justify-center">
                <WeatherIcon
                  icon={c.icon || "mostly_sunny"}
                  className="h-5 w-5"
                />
              </div>
              <p className="text-xl font-bold text-[var(--ink)]">
                {c.tempC != null ? `${c.tempC}°` : "—"}
              </p>
              <p className="text-[10px] text-[var(--ink)]/70">
                {c.wind ? `${c.wind} km/h` : "—"}
              </p>
              <p className="line-clamp-2 text-[10px] text-[var(--ink)]/65">
                {c.condition || "—"}
              </p>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function HomeWeekPanel() {
  const { forecast, loading, error, geohash, label } = useHomePlace();
  const days = forecast?.daily ?? [];
  const tz = forecast?.location.timezone || "Australia/Sydney";
  const shortName = forecast?.location.name || label.split(",")[0] || "Local";

  return (
    <section className="sw-panel p-3 text-[var(--ink)] sm:p-3.5">
      <h2 className="sw-panel-title">7-day forecast — {shortName}</h2>
      {loading && days.length === 0 ? (
        <p className="text-sm text-white/70">Loading…</p>
      ) : null}
      {error && days.length === 0 ? (
        <p className="text-sm text-white/80">{error}</p>
      ) : null}
      {days.length > 0 ? (
        <div className="flex justify-between gap-1 overflow-x-auto">
          {days.slice(0, 7).map((d, idx) => {
            const dayLabel =
              idx === 0
                ? "Today"
                : new Intl.DateTimeFormat("en-AU", {
                    timeZone: tz,
                    weekday: "short",
                  }).format(new Date(d.date));
            return (
              <div
                key={d.date}
                className="flex min-w-[2.75rem] flex-col items-center gap-1 text-center text-xs"
              >
                <span className="text-[var(--ink)]/65">{dayLabel}</span>
                <WeatherIcon
                  icon={d.icon}
                  night={d.isNight}
                  className="h-5 w-5"
                />
                <span className="font-bold text-[var(--cyan)]">
                  {d.tempMax != null ? `${d.tempMax}°` : "—"}
                </span>
                <span className="text-[var(--ink)]/75">
                  {d.tempMin != null ? `${d.tempMin}°` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <Link
        href={`/forecast/${geohash}`}
        className="mt-2.5 inline-block text-xs font-semibold text-[var(--cyan)] hover:underline"
      >
        Open full forecast →
      </Link>
    </section>
  );
}

export function HomeBriefingPanel() {
  const { forecast, loading } = useHomePlace();
  const today = forecast?.daily[0];
  const notes: string[] = [];
  if (today?.extendedText) notes.push(today.extendedText);
  if (today?.fireDanger) {
    notes.push(`Fire danger today: ${today.fireDanger}.`);
  }
  if (today?.rainChance != null && today.rainChance >= 30) {
    notes.push(
      `Rain chance ${rainLabel(today.rainChance, today.rainMinMm, today.rainMaxMm)}.`,
    );
  }

  return (
    <section className="sw-panel p-3.5 text-[var(--ink)]">
      <h2 className="sw-panel-title">Briefing notes</h2>
      {loading && notes.length === 0 ? (
        <p className="text-sm text-white/70">Loading briefing…</p>
      ) : null}
      {notes.length === 0 && !loading ? (
        <p className="text-sm text-white/75">No briefing notes right now.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((item) => (
            <li
              key={item}
              className="flex gap-2 text-sm leading-snug text-[var(--ink)]/85"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cyan)]" />
              <span className="line-clamp-4 sm:line-clamp-none">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Sync map region to saved place once when a place is first available. */
export function usePreferSavedRegion(
  setRegionId: (id: import("@/components/home/mock-data").MapRegionId) => void,
  enabled = true,
) {
  const { place, ready } = useSavedPlace();
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (!enabled || !ready || applied || !place?.regionId) return;
    if (place.regionId !== "national") {
      setRegionId(place.regionId);
    }
    setApplied(true);
  }, [enabled, ready, place, applied, setRegionId]);
}
