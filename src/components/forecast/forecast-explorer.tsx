"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Droplets,
  Gauge,
  Sunrise,
  Sunset,
  Thermometer,
  Wind,
} from "lucide-react";
import { SiteShell } from "@/components/site/site-shell";
import { LocationSearch } from "@/components/forecast/location-search";
import { WeatherIcon } from "@/components/forecast/weather-icon";
import {
  STATE_CAPITALS,
  formatClock,
  formatForecastDay,
  formatForecastHour,
  rainLabel,
  type LocationForecastPayload,
} from "@/lib/weather/location-forecast";
import { cn } from "@/lib/utils";

type Props = {
  geohash?: string | null;
  region?: string | null;
};

export function ForecastExplorer({ geohash = null, region = null }: Props) {
  const regionKey = (region || "").toLowerCase();
  const seed =
    geohash ||
    STATE_CAPITALS[regionKey]?.geohash ||
    STATE_CAPITALS.nsw.geohash;

  const [activeHash, setActiveHash] = useState(seed);
  const [data, setData] = useState<LocationForecastPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveHash(seed);
  }, [seed]);

  useEffect(() => {
    if (!activeHash) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/weather/forecast/${encodeURIComponent(activeHash)}`,
          { signal: ac.signal, cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "No BoM forecast for this location."
              : `Forecast unavailable (${res.status})`,
          );
        }
        const json = (await res.json()) as LocationForecastPayload;
        if (ac.signal.aborted) return;
        setData(json);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setData(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Forecast unavailable");
      }
    })();
    return () => ac.abort();
  }, [activeHash]);

  const tz = data?.location.timezone || "Australia/Sydney";
  const today = data?.daily[0] ?? null;
  const hourly = useMemo(() => data?.hourly.slice(0, 24) ?? [], [data]);
  const rainTimeline = useMemo(
    () => data?.hourly.slice(0, 48) ?? [],
    [data],
  );
  const maxRainMm = useMemo(() => {
    let max = 1;
    for (const h of rainTimeline) {
      const mm = h.rainMaxMm ?? h.rainMinMm ?? 0;
      if (mm > max) max = mm;
    }
    return max;
  }, [rainTimeline]);

  return (
    <SiteShell>
      <div className="mx-auto w-full max-w-[960px] px-3 py-5 sm:px-4 sm:py-6">
        <div className="mb-5 space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cyan)]">
              Bureau of Meteorology
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-white sm:text-3xl">
              Location forecast
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-white/70">
              Search any Australian suburb, town or postcode for the official
              BoM outlook.
            </p>
          </div>
          <LocationSearch
            className="w-full"
            onSelect={(loc) => {
              setActiveHash(loc.geohash);
              window.history.replaceState(
                null,
                "",
                `/forecast/${encodeURIComponent(loc.geohash)}`,
              );
            }}
          />
        </div>

        <div className="mb-5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
            Capitals
          </p>
          <div className="sw-chip-row">
            {Object.entries(STATE_CAPITALS)
              .filter(([key]) => key !== "australia")
              .map(([key, cap]) => (
                <Link
                  key={key}
                  href={`/forecast/${cap.geohash}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveHash(cap.geohash);
                    window.history.replaceState(
                      null,
                      "",
                      `/forecast/${cap.geohash}`,
                    );
                  }}
                  className={cn(
                    "sw-chip",
                    activeHash === cap.geohash
                      ? "sw-chip-active"
                      : "sw-chip-idle",
                  )}
                >
                  {cap.name}
                </Link>
              ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-white/70">Loading BoM forecast…</p>
        ) : null}
        {error ? (
          <div className="sw-panel p-4 text-sm text-white/85">{error}</div>
        ) : null}

        {data ? (
          <div className="space-y-4">
            <section className="sw-panel p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-white sm:text-2xl">
                    {data.location.name}
                    <span className="ml-2 text-sm font-semibold text-white/60 sm:text-base">
                      {data.location.state}
                      {data.location.postcode
                        ? ` ${data.location.postcode}`
                        : ""}
                    </span>
                  </h2>
                  {data.observation?.stationName ? (
                    <p className="mt-1 text-xs text-white/50">
                      Observations from {data.observation.stationName}
                      {data.observation.observationTime
                        ? ` · ${formatClock(data.observation.observationTime, tz)}`
                        : ""}
                    </p>
                  ) : null}
                </div>
                {today ? (
                  <div className="flex items-center gap-3">
                    <WeatherIcon
                      icon={today.icon}
                      night={today.isNight}
                      className="h-10 w-10"
                    />
                    <div className="text-right">
                      <p className="text-3xl font-bold leading-none text-white sm:text-4xl">
                        {data.observation?.temp != null
                          ? `${Math.round(data.observation.temp)}°`
                          : today.tempNow != null
                            ? `${Math.round(today.tempNow)}°`
                            : today.tempMax != null
                              ? `${Math.round(today.tempMax)}°`
                              : "—"}
                      </p>
                      <p className="mt-1 text-sm text-white/75">
                        {today.shortText}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                <Stat
                  icon={<Thermometer className="h-3.5 w-3.5" />}
                  label="Feels like"
                  value={
                    data.observation?.tempFeelsLike != null
                      ? `${Math.round(data.observation.tempFeelsLike)}°`
                      : "—"
                  }
                />
                <Stat
                  icon={<Wind className="h-3.5 w-3.5" />}
                  label="Wind"
                  value={
                    data.observation?.windKmh != null
                      ? `${data.observation.windDir || ""} ${Math.round(data.observation.windKmh)} km/h`.trim()
                      : "—"
                  }
                />
                <Stat
                  icon={<Droplets className="h-3.5 w-3.5" />}
                  label="Rain since 9am"
                  value={
                    data.observation?.rainSince9am != null
                      ? `${data.observation.rainSince9am} mm`
                      : "—"
                  }
                />
                <Stat
                  icon={<Gauge className="h-3.5 w-3.5" />}
                  label="Humidity"
                  value={
                    data.observation?.humidity != null
                      ? `${Math.round(data.observation.humidity)}%`
                      : "—"
                  }
                />
              </div>

              {today?.extendedText ? (
                <p className="mt-4 border-t border-white/10 pt-3 text-sm leading-relaxed text-white/80">
                  {today.extendedText}
                </p>
              ) : null}

              {today ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/65">
                  <span>
                    Max{" "}
                    <strong className="text-[var(--cyan)]">
                      {today.tempMax != null ? `${today.tempMax}°` : "—"}
                    </strong>
                  </span>
                  <span>
                    Min{" "}
                    <strong className="text-white">
                      {today.tempMin != null ? `${today.tempMin}°` : "—"}
                    </strong>
                  </span>
                  <span>
                    Rain{" "}
                    <strong className="text-white">
                      {rainLabel(
                        today.rainChance,
                        today.rainMinMm,
                        today.rainMaxMm,
                      )}
                    </strong>
                  </span>
                  {today.uvMaxIndex != null ? (
                    <span>
                      UV{" "}
                      <strong className="text-white">
                        {today.uvMaxIndex}
                        {today.uvCategory ? ` ${today.uvCategory}` : ""}
                      </strong>
                    </span>
                  ) : null}
                  {today.fireDanger ? (
                    <span>
                      Fire{" "}
                      <strong
                        className="text-white"
                        style={
                          today.fireDangerColour
                            ? { color: today.fireDangerColour }
                            : undefined
                        }
                      >
                        {today.fireDanger}
                      </strong>
                    </span>
                  ) : null}
                  {today.sunrise ? (
                    <span className="inline-flex items-center gap-1">
                      <Sunrise className="h-3 w-3" aria-hidden />
                      {formatClock(today.sunrise, tz)}
                    </span>
                  ) : null}
                  {today.sunset ? (
                    <span className="inline-flex items-center gap-1">
                      <Sunset className="h-3 w-3" aria-hidden />
                      {formatClock(today.sunset, tz)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </section>

            {hourly.length > 0 ? (
              <section className="sw-panel p-4">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                  Next 24 hours
                </h3>
                <div className="sw-chip-row sm:gap-2">
                  {hourly.map((h) => (
                    <div
                      key={h.time}
                      className="flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-md border border-white/10 bg-black/20 px-1.5 py-2 text-center sm:w-[72px]"
                    >
                      <p className="text-[10px] font-semibold uppercase text-white/55">
                        {formatForecastHour(h.time, tz)}
                      </p>
                      <WeatherIcon
                        icon={h.icon}
                        night={h.isNight}
                        className="h-5 w-5"
                      />
                      <p className="text-sm font-bold text-white">
                        {h.temp != null ? `${Math.round(h.temp)}°` : "—"}
                      </p>
                      <p className="text-[10px] text-sky-200">
                        {h.rainChance != null ? `${h.rainChance}%` : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {loading && !data ? null : rainTimeline.length > 0 ? (
              <section className="sw-panel p-4">
                <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                  Rain timeline
                </h3>
                <p className="mb-3 text-xs text-white/55">
                  Next {rainTimeline.length} hours — chance bars with optional
                  mm range from BoM hourly.
                </p>
                <div className="sw-chip-row items-end sm:gap-1">
                  {rainTimeline.map((h) => {
                    const chance = h.rainChance ?? 0;
                    const barH = 8 + (chance / 100) * 56;
                    const mmLabel =
                      h.rainMinMm != null || h.rainMaxMm != null
                        ? h.rainMinMm != null &&
                          h.rainMaxMm != null &&
                          h.rainMinMm !== h.rainMaxMm
                          ? `${h.rainMinMm}–${h.rainMaxMm}`
                          : `${h.rainMaxMm ?? h.rainMinMm}`
                        : null;
                    const mmFrac =
                      (h.rainMaxMm ?? h.rainMinMm ?? 0) / maxRainMm;
                    return (
                      <div
                        key={`rain-${h.time}`}
                        className="flex w-[2.35rem] shrink-0 flex-col items-center gap-1 sm:w-10"
                      >
                        <span className="text-[9px] font-semibold text-sky-200">
                          {h.rainChance != null ? `${h.rainChance}%` : "—"}
                        </span>
                        <div className="relative flex h-16 w-full items-end justify-center">
                          <div
                            className="w-[70%] rounded-t-sm bg-sky-400/35"
                            style={{ height: `${barH}px` }}
                          />
                          {mmFrac > 0 ? (
                            <div
                              className="absolute bottom-0 w-[40%] rounded-t-sm bg-sky-300/90"
                              style={{
                                height: `${Math.max(3, mmFrac * 40)}px`,
                              }}
                            />
                          ) : null}
                        </div>
                        <span className="text-[9px] text-white/45">
                          {formatForecastHour(h.time, tz)}
                        </span>
                        <span className="h-3 text-[8px] text-white/40">
                          {mmLabel ? `${mmLabel}` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-white/40">
                  Tall bars = rain chance · thin core = relative mm range
                </p>
              </section>
            ) : !loading && data ? (
              <section className="sw-panel p-4">
                <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                  Rain timeline
                </h3>
                <p className="text-sm text-white/65">
                  No hourly rain guidance for this location right now.
                </p>
              </section>
            ) : null}

            {data.daily.length > 0 ? (
              <section className="sw-panel p-4">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--cyan)]">
                  7-day forecast
                </h3>
                <ul className="divide-y divide-white/10">
                  {data.daily.map((day, idx) => (
                    <li
                      key={day.date}
                      className="flex items-center gap-2.5 py-3 first:pt-0 last:pb-0 sm:gap-3"
                    >
                      <p className="w-16 shrink-0 text-sm font-semibold text-white sm:w-24">
                        {idx === 0 ? "Today" : formatForecastDay(day.date, tz)}
                      </p>
                      <WeatherIcon
                        icon={day.icon}
                        night={day.isNight}
                        className="h-6 w-6 shrink-0"
                      />
                      <p className="min-w-0 flex-1 truncate text-sm text-white/75 sm:whitespace-normal sm:line-clamp-2">
                        {day.shortText || "—"}
                      </p>
                      <p className="hidden w-24 shrink-0 text-right text-xs text-sky-200 sm:block">
                        {rainLabel(
                          day.rainChance,
                          day.rainMinMm,
                          day.rainMaxMm,
                        )}
                      </p>
                      <p className="w-[4.5rem] shrink-0 text-right text-sm font-bold text-white sm:w-24">
                        <span className="text-white/50">
                          {day.tempMin != null ? `${day.tempMin}°` : "—"}
                        </span>
                        {" / "}
                        <span className="text-[var(--cyan)]">
                          {day.tempMax != null ? `${day.tempMax}°` : "—"}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="text-xs text-white/45">
              Source: {data.attribution}
              {data.issueTime
                ? ` · Issued ${formatClock(data.issueTime, tz)}`
                : ""}
              . Official forecasts may change — always check BoM for warnings.
            </p>
          </div>
        ) : null}
      </div>
    </SiteShell>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-black/15 px-3 py-2.5">
      <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/55">
        {icon}
        {label}
      </p>
      <p className="text-sm font-bold text-white">{value}</p>
    </div>
  );
}
