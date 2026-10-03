"use client";

import { ChevronDown, Link2, Pause, Play } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import {
  DEFAULT_MAP_REGION,
  DEFAULT_MAP_SETTINGS,
  MAP_REGIONS,
  getMapRegion,
  type MapRegionId,
  type MapSettingsState,
} from "@/components/home/mock-data";
import {
  ARCHIVE_STEP_SEC,
  aestPartsToUnix,
  formatAestDateKey,
  formatArchiveDateTimeLabel,
  quantizeArchiveStamp,
  unixToAestParts,
  type AestParts,
} from "@/lib/weather/archive-time";
import {
  ARCHIVE_LOOP_OPTIONS,
  DEFAULT_ARCHIVE_LOOP_HOURS,
  archiveFrameUrl,
  buildArchiveScrubFrames,
  clampArchiveLoopHours,
  parseArchiveLoopParam,
} from "@/lib/weather/archive-client";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SATELLITE_PRODUCT,
  GIBS_AU_BOUNDS,
  PLAYBACK_SPEEDS,
  formatFrameTimeAEST,
  frameIndexToScrub,
  getPlaybackSpeed,
  getSatelliteProduct,
  isSatelliteProductId,
  satelliteFrameProxyUrl,
  scrubToFrameIndex,
  timelineEdgeLabels,
  type PlaybackSpeedId,
  type SatelliteProductId,
  type WeatherFrame,
} from "@/lib/weather/maps";
import type { SynopticFrame } from "@/lib/weather/synoptic";
import type { SynopticGeoJson } from "@/lib/weather/synoptic-contour";
import { cn } from "@/lib/utils";

type CatalogProduct = { id: SatelliteProductId; label: string };

type Catalog = {
  epochUnix: number;
  epochLabel: string;
  tipUnix: number;
  products: CatalogProduct[];
  times: number[];
  attribution: {
    satellite: string;
    synoptic: string;
    lightning: string;
  };
};

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition",
        on ? "bg-[var(--cyan)]" : "bg-white/20",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition",
          on && "translate-x-4",
        )}
      />
    </button>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/55">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-white/15 bg-[#0f172a] px-2 py-1.5 text-sm font-semibold text-white"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function clampPartsToRange(
  parts: AestParts,
  epochUnix: number,
  tipUnix: number,
): AestParts {
  let unix = aestPartsToUnix(parts);
  if (unix < epochUnix) return unixToAestParts(epochUnix);
  if (unix > tipUnix) return unixToAestParts(tipUnix);
  return parts;
}

function ArchiveDashboardInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [availableTimes, setAvailableTimes] = useState<number[]>([]);
  const [product, setProduct] = useState<SatelliteProductId>(
    DEFAULT_SATELLITE_PRODUCT,
  );
  const [regionId, setRegionId] = useState<MapRegionId>(DEFAULT_MAP_REGION);
  const [parts, setParts] = useState<AestParts | null>(null);
  const [showLightning, setShowLightning] = useState(true);
  const [showSynoptic, setShowSynoptic] = useState(true);
  const [loopHours, setLoopHours] = useState(DEFAULT_ARCHIVE_LOOP_HOURS);
  const [playing, setPlaying] = useState(false);
  const [speedId, setSpeedId] = useState<PlaybackSpeedId>(DEFAULT_PLAYBACK_SPEED);
  const [frameIndex, setFrameIndex] = useState(0);
  const [mapSettings, setMapSettings] =
    useState<MapSettingsState>(DEFAULT_MAP_SETTINGS);
  const [lightning, setLightning] = useState<LightningStrike[]>([]);
  const [synopticGeoJson, setSynopticGeoJson] =
    useState<SynopticGeoJson | null>(null);
  const [synopticValidTime, setSynopticValidTime] = useState<number | null>(
    null,
  );
  const [synopticAttribution, setSynopticAttribution] = useState<string | null>(
    null,
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const [satMenuOpen, setSatMenuOpen] = useState(false);
  const regionMenuRef = useRef<HTMLDivElement>(null);
  const satMenuRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  // Load catalog
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/weather/archive", { cache: "no-store" });
        if (!res.ok) throw new Error(`Catalog ${res.status}`);
        const data = (await res.json()) as Catalog & {
          products: CatalogProduct[];
        };
        if (cancelled) return;
        setCatalog(data);
        setCatalogError(null);
        if (!hydrated.current) {
          const tParam = searchParams.get("t");
          const t = tParam ? Number(tParam) : data.tipUnix;
          const unix = Number.isFinite(t)
            ? Math.min(Math.max(t, data.epochUnix), data.tipUnix)
            : data.tipUnix;
          setParts(unixToAestParts(quantizeArchiveStamp(unix)));
          const p = searchParams.get("product");
          if (p && isSatelliteProductId(p)) setProduct(p);
          else if (data.products[0]) setProduct(data.products[0].id);
          const r = searchParams.get("region");
          if (r && MAP_REGIONS.some((x) => x.id === r)) {
            setRegionId(r as MapRegionId);
          }
          if (searchParams.get("lightning") === "0") setShowLightning(false);
          if (searchParams.get("synoptic") === "0") setShowSynoptic(false);
          const loop = parseArchiveLoopParam(searchParams.get("loop"));
          if (loop != null) setLoopHours(loop);
          hydrated.current = true;
        }
      } catch (err) {
        if (!cancelled) {
          setCatalogError(
            err instanceof Error ? err.message : "Archive unavailable",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once from URL
  }, []);

  const selectedUnix = useMemo(() => {
    if (!parts || !catalog) return null;
    const clamped = clampPartsToRange(parts, catalog.epochUnix, catalog.tipUnix);
    return quantizeArchiveStamp(aestPartsToUnix(clamped));
  }, [parts, catalog]);

  // Day index for selected date
  useEffect(() => {
    if (!selectedUnix || !catalog) return;
    const date = formatAestDateKey(selectedUnix);
    let cancelled = false;
    (async () => {
      try {
        const q = new URLSearchParams({
          date,
          product,
        });
        const res = await fetch(`/api/weather/archive?${q}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { times?: number[] };
        if (!cancelled) setAvailableTimes(data.times ?? []);
      } catch {
        if (!cancelled) setAvailableTimes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedUnix, product, catalog]);

  const availableSet = useMemo(
    () => new Set(availableTimes),
    [availableTimes],
  );

  const frames: WeatherFrame[] = useMemo(() => {
    if (!selectedUnix || !catalog) return [];
    // Always use expected 10-min slots; frame API captures on demand.
    return buildArchiveScrubFrames(
      product,
      selectedUnix,
      catalog.epochUnix,
      catalog.tipUnix,
      loopHours,
    );
  }, [selectedUnix, catalog, product, loopHours]);

  // Prefetch a few upcoming frames so play/scrub stays smooth.
  useEffect(() => {
    if (frames.length === 0) return;
    const urls: string[] = [];
    for (let i = 0; i < 6; i++) {
      const f = frames[(frameIndex + i) % frames.length];
      if (f?.imageUrl) urls.push(f.imageUrl);
    }
    for (const url of urls) {
      const img = new window.Image();
      img.src = url;
    }
  }, [frames, frameIndex]);

  // Keep frame index near selected time
  useEffect(() => {
    if (!selectedUnix || frames.length === 0) {
      setFrameIndex(0);
      return;
    }
    let best = 0;
    let bestDist = Infinity;
    frames.forEach((f, i) => {
      const d = Math.abs(f.time - selectedUnix);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setFrameIndex(best);
  }, [selectedUnix, frames]);

  const activeFrame = frames[frameIndex] ?? null;
  const activeTime = activeFrame?.time ?? selectedUnix;

  const loopStartUnix = frames[0]?.time ?? null;
  const loopEndUnix = frames.length > 0 ? frames[frames.length - 1]!.time : null;

  // Lightning for the whole loop (+ 3h trail before start), not per-frame.
  useEffect(() => {
    if (!showLightning || !catalog || loopStartUnix == null || loopEndUnix == null) {
      if (!showLightning) setLightning([]);
      return;
    }
    let cancelled = false;
    const from = Math.max(catalog.epochUnix, loopStartUnix - 3 * 3600);
    const to = loopEndUnix;
    (async () => {
      try {
        const q = new URLSearchParams({
          from: String(from),
          to: String(to),
        });
        const res = await fetch(`/api/weather/archive/lightning?${q}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { strikes?: LightningStrike[] };
        if (!cancelled && data.strikes) setLightning(data.strikes);
      } catch {
        // Keep previous strikes on transient failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showLightning, catalog, loopStartUnix, loopEndUnix]);

  // Synoptic nearest to active time — keep last good field on errors.
  useEffect(() => {
    if (!showSynoptic || activeTime == null) {
      if (!showSynoptic) {
        setSynopticGeoJson(null);
        setSynopticValidTime(null);
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/weather/archive/synoptic?time=${activeTime}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          geojson?: SynopticGeoJson;
          time?: number;
          attribution?: string;
        };
        if (cancelled || !data.geojson) return;
        setSynopticGeoJson(data.geojson);
        setSynopticValidTime(data.time ?? null);
        setSynopticAttribution(data.attribution ?? null);
      } catch {
        // Keep previous synoptic overlay.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showSynoptic, activeTime]);

  // Playback
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const ms = getPlaybackSpeed(speedId).msPerFrame;
    const id = window.setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, ms);
    return () => window.clearInterval(id);
  }, [playing, frames.length, speedId]);

  // Sync parts when scrubbing
  useEffect(() => {
    if (!activeFrame || playing) return;
    // don't fight date selects while user is picking — only when scrub moves
  }, [activeFrame, playing]);

  useEffect(() => {
    if (!playing || !activeFrame) return;
    setParts(unixToAestParts(activeFrame.time));
  }, [playing, activeFrame]);

  // URL sync
  useEffect(() => {
    if (!hydrated.current || !selectedUnix || pathname !== "/archive") return;
    const params = new URLSearchParams();
    params.set("t", String(activeTime ?? selectedUnix));
    params.set("product", product);
    if (regionId !== "national") params.set("region", regionId);
    if (showLightning) params.set("lightning", "1");
    else params.set("lightning", "0");
    if (showSynoptic) params.set("synoptic", "1");
    else params.set("synoptic", "0");
    params.set("loop", String(loopHours));
    const next = `?${params.toString()}`;
    if (window.location.search !== next) {
      window.history.replaceState(null, "", `/archive${next}`);
    }
  }, [
    pathname,
    selectedUnix,
    activeTime,
    product,
    regionId,
    showLightning,
    showSynoptic,
    loopHours,
  ]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (
        satMenuRef.current &&
        !satMenuRef.current.contains(e.target as Node)
      ) {
        setSatMenuOpen(false);
      }
      if (
        regionMenuRef.current &&
        !regionMenuRef.current.contains(e.target as Node)
      ) {
        setRegionMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const region = getMapRegion(regionId);
  const satProductMeta = getSatelliteProduct(product);
  const productOptions = catalog?.products?.length
    ? catalog.products
    : [{ id: product, label: satProductMeta.label }];

  const yearOptions = useMemo(() => {
    if (!catalog) return [];
    const a = unixToAestParts(catalog.epochUnix).year;
    const b = unixToAestParts(catalog.tipUnix).year;
    const years: number[] = [];
    for (let y = a; y <= b; y++) years.push(y);
    return years;
  }, [catalog]);

  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: new Date(2000, i, 1).toLocaleString("en-AU", { month: "short" }),
    }));
  }, []);

  const dayOptions = useMemo(() => {
    if (!parts) return [];
    const daysInMonth = new Date(parts.year, parts.month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => ({
      value: i + 1,
      label: String(i + 1),
    }));
  }, [parts]);

  const hourOptions = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        value: i,
        label: `${String(i).padStart(2, "0")}:00`,
      })),
    [],
  );

  const minuteOptions = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        value: i * 10,
        label: String(i * 10).padStart(2, "0"),
      })),
    [],
  );

  const edges = timelineEdgeLabels(frames);
  const scrub = frameIndexToScrub(frameIndex, frames.length);
  const frameArchived =
    activeTime == null
      ? false
      : availableSet.size === 0
        ? true // unknown until day index loads; on-demand API will capture
        : availableSet.has(activeTime);

  const synopticFrames: SynopticFrame[] =
    synopticValidTime != null
      ? [
          {
            time: synopticValidTime,
            stamp: String(synopticValidTime),
            geojsonUrl: `/api/weather/archive/synoptic?time=${synopticValidTime}`,
          },
        ]
      : [];

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  function updatePart<K extends keyof AestParts>(key: K, value: number) {
    if (!parts || !catalog) return;
    const next = clampPartsToRange(
      { ...parts, [key]: value, minute: key === "minute" ? value : parts.minute },
      catalog.epochUnix,
      catalog.tipUnix,
    );
    // Snap minute to 10
    next.minute = Math.floor(next.minute / 10) * 10;
    setParts(next);
    setPlaying(false);
  }

  if (catalogError) {
    return (
      <div className="px-4 py-10 text-center text-white/80">
        <p className="text-lg font-semibold">Archive unavailable</p>
        <p className="mt-2 text-sm text-white/55">{catalogError}</p>
      </div>
    );
  }

  if (!catalog || !parts) {
    return (
      <div className="px-4 py-10 text-center text-sm text-white/55">
        Loading archive…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-4 sm:px-5 lg:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Archive
        </h1>
        <p className="max-w-2xl text-sm text-white/65">
          Satellite, synoptic and lightning from {catalog.epochLabel} onward.
          Pick a date and time in Australian Eastern time.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
        <SelectField
          label="Year"
          value={parts.year}
          onChange={(v) => updatePart("year", v)}
          options={yearOptions.map((y) => ({ value: y, label: String(y) }))}
        />
        <SelectField
          label="Month"
          value={parts.month}
          onChange={(v) => updatePart("month", v)}
          options={monthOptions}
        />
        <SelectField
          label="Day"
          value={parts.day}
          onChange={(v) => updatePart("day", v)}
          options={dayOptions}
        />
        <SelectField
          label="Hour"
          value={parts.hour}
          onChange={(v) => updatePart("hour", v)}
          options={hourOptions}
        />
        <SelectField
          label="Minute"
          value={parts.minute}
          onChange={(v) => updatePart("minute", v)}
          options={minuteOptions}
        />
        <SelectField
          label="Loop length"
          value={loopHours}
          onChange={(v) => {
            setLoopHours(clampArchiveLoopHours(v));
            setPlaying(false);
          }}
          options={ARCHIVE_LOOP_OPTIONS.map((o) => ({
            value: o.hours,
            label: o.label,
          }))}
        />
        <div className="min-w-[10rem] flex-1 text-sm text-white/70">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-white/55">
            Selected
          </div>
          <div className="font-semibold text-white">
            {selectedUnix
              ? formatArchiveDateTimeLabel(selectedUnix)
              : "—"}
          </div>
          <div className="text-[11px] text-white/45">
            {frames.length} frames · every {ARCHIVE_STEP_SEC / 60} min
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/55">
            Layers
          </p>
          <div className="flex items-center justify-between gap-2 text-sm text-white">
            <span>Lightning tracker</span>
            <Toggle
              on={showLightning}
              onChange={setShowLightning}
              label="Lightning tracker"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-white">
            <span>Bolt icons</span>
            <Toggle
              on={mapSettings.lightningBolts}
              onChange={(on) =>
                setMapSettings((s) => ({ ...s, lightningBolts: on }))
              }
              label="Lightning bolt icons"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-white">
            <span>Synoptic</span>
            <Toggle
              on={showSynoptic}
              onChange={setShowSynoptic}
              label="Synoptic"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-white/45">
            {showLightning
              ? `${lightning.length.toLocaleString()} strikes in loop window.`
              : "Lightning off."}{" "}
            Frames every {ARCHIVE_STEP_SEC / 60} minutes (national).
          </p>
        </aside>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="relative z-[60] flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-white/55">
              View
            </span>
            <div className="relative" ref={satMenuRef}>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={satMenuOpen}
                onClick={() => {
                  setRegionMenuOpen(false);
                  setSatMenuOpen((o) => !o);
                }}
                className="sw-chip sw-chip-active inline-flex items-center gap-1"
              >
                Satellite
                <span className="hidden font-normal opacity-80 sm:inline">
                  · {satProductMeta.label}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 opacity-80 transition",
                    satMenuOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {satMenuOpen ? (
                <ul
                  role="listbox"
                  aria-label="Satellite product"
                  className="absolute left-0 top-full z-[70] mt-1 max-h-72 min-w-[13rem] overflow-y-auto rounded-xl border border-white/10 bg-[#0f172a]/95 py-1 text-white shadow-xl backdrop-blur-xl"
                >
                  {productOptions.map((p) => (
                    <li key={p.id} role="option" aria-selected={product === p.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center px-3 py-2 text-left text-sm font-semibold transition",
                          product === p.id
                            ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                            : "text-white/80 hover:bg-white/5 hover:text-white",
                        )}
                        onClick={() => {
                          setProduct(p.id);
                          setSatMenuOpen(false);
                        }}
                      >
                        {p.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="relative z-[70]" ref={regionMenuRef}>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={regionMenuOpen}
                onClick={() => {
                  setSatMenuOpen(false);
                  setRegionMenuOpen((o) => !o);
                }}
                className={cn(
                  "sw-chip inline-flex items-center gap-1",
                  regionId !== "national" ? "sw-chip-active" : "sw-chip-idle",
                )}
              >
                Region
                <span className="font-normal opacity-80">· {region.short}</span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 opacity-80 transition",
                    regionMenuOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {regionMenuOpen ? (
                <ul
                  role="listbox"
                  aria-label="Map region"
                  className="absolute left-0 top-full z-[80] mt-1 max-h-80 min-w-[14rem] overflow-y-auto rounded-xl border border-white/10 bg-[#0f172a]/95 py-1 text-white shadow-xl backdrop-blur-xl"
                >
                  {MAP_REGIONS.map((r) => (
                    <li
                      key={r.id}
                      role="option"
                      aria-selected={regionId === r.id}
                    >
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold transition",
                          regionId === r.id
                            ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                            : "text-white/80 hover:bg-white/5 hover:text-white",
                        )}
                        onClick={() => {
                          setRegionId(r.id);
                          setRegionMenuOpen(false);
                        }}
                      >
                        <span>{r.label}</span>
                        <span className="text-[10px] font-bold opacity-70">
                          {r.short}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void copyShareLink()}
              className="sw-chip sw-chip-idle inline-flex items-center gap-1"
              title="Copy shareable archive link"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {linkCopied ? "Copied" : "Copy link"}
            </button>
          </div>

          <div className="relative z-0 w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
            <HomeMapDynamic
              mode="Satellite"
              regionId={regionId}
              showRadarOverlay={false}
              frameImageUrl={
                activeFrame
                  ? archiveFrameUrl(product, activeFrame.time)
                  : null
              }
              frameImageFallbackUrl={
                activeFrame
                  ? satelliteFrameProxyUrl(product, activeFrame.time, {
                      region: "national",
                    })
                  : null
              }
              frameImageBounds={GIBS_AU_BOUNDS}
              frameKey={
                activeFrame
                  ? `archive-${product}-${regionId}`
                  : "archive-empty"
              }
              frameOpacity={1}
              frameAlt={`${satProductMeta.label} archive`}
              mapSettings={mapSettings}
              showLightning={showLightning}
              lightningStrikes={lightning}
              lightningReferenceTime={activeTime}
              lightningTimelineStart={
                frames[0] != null ? frames[0].time - 3 * 3600 : null
              }
              lightningTimelineEnd={
                frames.length > 0 ? frames[frames.length - 1]!.time : activeTime
              }
              lightningPlaying={playing}
              lightningMsPerFrame={getPlaybackSpeed(speedId).msPerFrame}
              lightningNextFrameTime={
                frames[(frameIndex + 1) % Math.max(frames.length, 1)]?.time ??
                null
              }
              showSynoptic={showSynoptic}
              synopticFrames={synopticFrames}
              synopticGeoJson={synopticGeoJson}
              synopticValidTime={synopticValidTime}
              synopticReferenceTime={activeTime}
            />
            {!frameArchived && activeTime != null ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-12 z-[40] flex justify-center px-3">
                <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-amber-200">
                  Capturing this frame from live satellite…
                </span>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="sw-chip sw-chip-idle inline-flex items-center gap-1"
                onClick={() => setPlaying((p) => !p)}
                disabled={frames.length < 2}
              >
                {playing ? (
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Play className="h-3.5 w-3.5" aria-hidden />
                )}
                {playing ? "Pause" : "Play"}
              </button>
              {PLAYBACK_SPEEDS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSpeedId(s.id)}
                  className={cn(
                    "sw-chip",
                    speedId === s.id ? "sw-chip-active" : "sw-chip-idle",
                  )}
                >
                  {s.label}
                </button>
              ))}
              <span className="ml-auto text-xs font-semibold text-white/70">
                {activeTime != null ? formatFrameTimeAEST(activeTime) : "—"}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={scrub}
              onChange={(e) => {
                setPlaying(false);
                const idx = scrubToFrameIndex(Number(e.target.value), frames.length);
                setFrameIndex(idx);
                const f = frames[idx];
                if (f) setParts(unixToAestParts(f.time));
              }}
              className="w-full accent-[var(--cyan)]"
              aria-label="Archive timeline"
            />
            <div className="mt-1 flex justify-between text-[10px] font-semibold text-white/45">
              <span>{edges.start}</span>
              <span>{edges.mid}</span>
              <span>{edges.end}</span>
            </div>
          </div>
        </div>
      </div>

      <footer className="space-y-1 text-[11px] leading-relaxed text-white/45">
        <p>{catalog.attribution.satellite}</p>
        <p>{synopticAttribution ?? catalog.attribution.synoptic}</p>
        <p>{catalog.attribution.lightning}</p>
      </footer>
    </div>
  );
}

export function ArchiveDashboard() {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-10 text-center text-sm text-white/55">
          Loading archive…
        </div>
      }
    >
      <ArchiveDashboardInner />
    </Suspense>
  );
}
