"use client";

import { ChevronDown, Link2, Pause, Play } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { HomeMapDynamic } from "@/components/home/home-map-dynamic";
import {
  clampLightningIconScale,
  LIGHTNING_ICON_SCALE_MAX,
  LIGHTNING_ICON_SCALE_MIN,
  LIGHTNING_ICON_SCALE_STEP,
  MAP_REGIONS,
  getMapRegion,
  type MapRegionId,
  type MapSettingsState,
} from "@/components/home/mock-data";
import { useLightning } from "@/hooks/use-lightning";
import { useStations } from "@/hooks/use-stations";
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
  buildArchiveScrubFrames,
  clampArchiveLoopHours,
  parseArchiveLoopParam,
} from "@/lib/weather/archive-client";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
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
import { replaceUrlIfOnPath } from "@/lib/nav/safe-history";
import {
  readArchiveUiPrefs,
  writeArchiveUiPrefs,
} from "@/lib/prefs/map-ui";
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
  const savedUi = useMemo(() => readArchiveUiPrefs(), []);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [availableTimes, setAvailableTimes] = useState<number[]>([]);
  const [product, setProduct] = useState<SatelliteProductId>(
    () => savedUi.product,
  );
  const [regionId, setRegionId] = useState<MapRegionId>(() => savedUi.regionId);
  const [parts, setParts] = useState<AestParts | null>(null);
  const [showLightning, setShowLightning] = useState(
    () => savedUi.showLightning,
  );
  const [showSynoptic, setShowSynoptic] = useState(() => savedUi.showSynoptic);
  const [showStations, setShowStations] = useState(() => savedUi.showStations);
  const { stations: weatherStations } = useStations(showStations);
  const [loopHours, setLoopHours] = useState(() => savedUi.loopHours);
  const [playing, setPlaying] = useState(false);
  const [speedId, setSpeedId] = useState<PlaybackSpeedId>(() => savedUi.speedId);
  const [frameIndex, setFrameIndex] = useState(0);
  const [mapSettings, setMapSettings] = useState<MapSettingsState>(
    () => savedUi.mapSettings,
  );
  const [archiveLightning, setArchiveLightning] = useState<LightningStrike[]>(
    [],
  );
  const [lightningTotal, setLightningTotal] = useState(0);
  const [lightningLoading, setLightningLoading] = useState(false);
  /** Browser WS + HTTP feed fills gaps when serverless archive/live is cold. */
  const liveLightning = useLightning(showLightning);
  const lightning = useMemo(() => {
    if (!showLightning) return [];
    if (liveLightning.strikes.length === 0) return archiveLightning;
    if (archiveLightning.length === 0) return liveLightning.strikes;
    const map = new Map<string, LightningStrike>();
    for (const s of archiveLightning) map.set(s.id, s);
    for (const s of liveLightning.strikes) map.set(s.id, s);
    return [...map.values()].sort((a, b) => a.time - b.time);
  }, [showLightning, archiveLightning, liveLightning.strikes]);
  const [synopticGeoJson, setSynopticGeoJson] =
    useState<SynopticGeoJson | null>(null);
  const frameIndexRef = useRef(0);
  const loadedFramesRef = useRef(new Set<string>());
  const playingRef = useRef(false);
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
          // Client rehydrate from localStorage (SSR used defaults), then URL.
          const saved = readArchiveUiPrefs();
          setMapSettings(saved.mapSettings);
          setSpeedId(saved.speedId);
          setShowLightning(saved.showLightning);
          setShowSynoptic(saved.showSynoptic);
          setShowStations(saved.showStations);
          setLoopHours(saved.loopHours);
          setRegionId(saved.regionId);
          if (
            data.products.some((x) => x.id === saved.product)
          ) {
            setProduct(saved.product);
          } else if (data.products[0]) {
            setProduct(data.products[0].id);
          }

          const tParam = searchParams.get("t");
          const t = tParam ? Number(tParam) : data.tipUnix;
          const unix = Number.isFinite(t)
            ? Math.min(Math.max(t, data.epochUnix), data.tipUnix)
            : data.tipUnix;
          setParts(unixToAestParts(quantizeArchiveStamp(unix)));
          // Shareable URL params win over saved prefs.
          const p = searchParams.get("product");
          if (p && isSatelliteProductId(p)) {
            setProduct(p);
          }
          const r = searchParams.get("region");
          if (r && MAP_REGIONS.some((x) => x.id === r)) {
            setRegionId(r as MapRegionId);
          }
          const lightning = searchParams.get("lightning");
          if (lightning === "0") setShowLightning(false);
          else if (lightning === "1") setShowLightning(true);
          const synoptic = searchParams.get("synoptic");
          if (synoptic === "0") setShowSynoptic(false);
          else if (synoptic === "1") setShowSynoptic(true);
          const stations = searchParams.get("stations");
          if (stations === "0") setShowStations(false);
          else if (stations === "1") setShowStations(true);
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
    // Region zooms the raster to the state crop (same as Satellite page).
    return buildArchiveScrubFrames(
      product,
      selectedUnix,
      catalog.epochUnix,
      catalog.tipUnix,
      loopHours,
      undefined,
      regionId,
    );
  }, [selectedUnix, catalog, product, loopHours, regionId]);

  const prefetchFrame = (url: string) =>
    new Promise<boolean>((resolve) => {
      if (loadedFramesRef.current.has(url)) {
        resolve(true);
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        loadedFramesRef.current.add(url);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = url;
    });

  // Drop cached decode list when the crop/product changes.
  useEffect(() => {
    loadedFramesRef.current.clear();
  }, [regionId, product]);

  // Prefetch the loop from the playhead outward (bounded concurrency) so play
  // does not stall on a cold capture chain.
  useEffect(() => {
    if (frames.length === 0) return;
    let cancelled = false;
    const order: WeatherFrame[] = [];
    for (let i = 0; i < frames.length; i++) {
      order.push(frames[(frameIndexRef.current + i) % frames.length]!);
    }
    const CONCURRENCY = 3;
    (async () => {
      let cursor = 0;
      async function worker() {
        while (!cancelled && cursor < order.length) {
          const idx = cursor++;
          const f = order[idx];
          if (!f?.imageUrl) continue;
          await prefetchFrame(f.imageUrl);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, order.length) }, () =>
          worker(),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [frames]);

  // Keep frame index near selected time
  useEffect(() => {
    if (!selectedUnix || frames.length === 0) {
      frameIndexRef.current = 0;
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
    frameIndexRef.current = best;
    setFrameIndex(best);
  }, [selectedUnix, frames]);

  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const activeFrame = frames[frameIndex] ?? null;
  const activeTime = activeFrame?.time ?? selectedUnix;

  const loopStartUnix = frames[0]?.time ?? null;
  const loopEndUnix = frames.length > 0 ? frames[frames.length - 1]!.time : null;

  // Lightning for the whole loop (+ 3h trail before start), not per-frame.
  useEffect(() => {
    if (!showLightning || !catalog || loopStartUnix == null || loopEndUnix == null) {
      if (!showLightning) {
        setArchiveLightning([]);
        setLightningTotal(0);
        setLightningLoading(false);
      }
      return;
    }
    let cancelled = false;
    setLightningLoading(true);
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
        if (!res.ok) {
          if (!cancelled) setLightningLoading(false);
          return;
        }
        const data = (await res.json()) as {
          strikes?: LightningStrike[];
          total?: number;
        };
        if (cancelled || !data.strikes) return;
        setArchiveLightning(data.strikes);
        setLightningTotal(data.total ?? data.strikes.length);
      } catch {
        // Keep previous strikes on transient failure.
      } finally {
        if (!cancelled) setLightningLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showLightning, catalog, loopStartUnix, loopEndUnix]);

  // Synoptic: snap to the hour while playing so we don't refetch every IR step.
  const synopticQueryTime = useMemo(() => {
    if (activeTime == null) return null;
    if (!playing) return activeTime;
    return Math.floor(activeTime / 3600) * 3600;
  }, [activeTime, playing]);

  useEffect(() => {
    if (!showSynoptic || synopticQueryTime == null) {
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
          `/api/weather/archive/synoptic?time=${synopticQueryTime}`,
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
  }, [showSynoptic, synopticQueryTime]);

  // Smooth playback: wait for the next decoded frame, pause briefly on wrap.
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const baseMs = getPlaybackSpeed(speedId).msPerFrame;
    // Archive needs a bit more dwell so on-demand captures don't stutter.
    const ms = Math.max(baseMs + 80, Math.round(baseMs * 1.25));
    let cancelled = false;

    const sleep = (n: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, n);
      });

    (async () => {
      while (!cancelled && playingRef.current) {
        const cur = frameIndexRef.current;
        const next = (cur + 1) % frames.length;
        const nextUrl = frames[next]?.imageUrl;
        if (nextUrl) {
          const waitStart = performance.now();
          while (
            !loadedFramesRef.current.has(nextUrl) &&
            performance.now() - waitStart < Math.max(ms * 4, 2500)
          ) {
            await prefetchFrame(nextUrl);
            if (cancelled || !playingRef.current) return;
            if (!loadedFramesRef.current.has(nextUrl)) await sleep(40);
          }
        }
        if (cancelled || !playingRef.current) return;
        // Soft loop: hold the last frame briefly before recycling.
        if (next === 0) await sleep(Math.max(420, ms));
        if (cancelled || !playingRef.current) return;
        frameIndexRef.current = next;
        setFrameIndex(next);
        // Prefetch a couple ahead of the playhead.
        for (let ahead = 1; ahead <= 3; ahead++) {
          const f = frames[(next + ahead) % frames.length];
          if (f?.imageUrl) void prefetchFrame(f.imageUrl);
        }
        await sleep(ms);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playing, frames, speedId]);

  // URL sync — skip while playing to avoid history thrash every frame.
  // Guarded so async archive updates cannot yank users back from other routes.
  useEffect(() => {
    if (!hydrated.current || !selectedUnix || pathname !== "/archive") return;
    if (playing) return;
    const params = new URLSearchParams();
    params.set("t", String(activeTime ?? selectedUnix));
    params.set("product", product);
    if (regionId !== "national") params.set("region", regionId);
    if (showLightning) params.set("lightning", "1");
    else params.set("lightning", "0");
    if (showSynoptic) params.set("synoptic", "1");
    else params.set("synoptic", "0");
    params.set("loop", String(loopHours));
    replaceUrlIfOnPath("/archive", `/archive?${params.toString()}`);
  }, [
    pathname,
    selectedUnix,
    activeTime,
    product,
    regionId,
    showLightning,
    showSynoptic,
    loopHours,
    playing,
  ]);

  // Persist overlays / cartography / loop prefs across visits.
  useEffect(() => {
    if (!hydrated.current) return;
    writeArchiveUiPrefs({
      showLightning,
      showSynoptic,
      showStations,
      mapSettings,
      product,
      regionId,
      loopHours,
      speedId,
    });
  }, [
    showLightning,
    showSynoptic,
    showStations,
    mapSettings,
    product,
    regionId,
    loopHours,
    speedId,
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
    if (!catalog || !parts) {
      return Array.from({ length: 12 }, (_, i) => ({
        value: i + 1,
        label: new Date(2000, i, 1).toLocaleString("en-AU", { month: "short" }),
      }));
    }
    const epoch = unixToAestParts(catalog.epochUnix);
    const tip = unixToAestParts(catalog.tipUnix);
    const months: { value: number; label: string }[] = [];
    for (let m = 1; m <= 12; m++) {
      if (parts.year === epoch.year && m < epoch.month) continue;
      if (parts.year === tip.year && m > tip.month) continue;
      months.push({
        value: m,
        label: new Date(2000, m - 1, 1).toLocaleString("en-AU", {
          month: "short",
        }),
      });
    }
    return months;
  }, [catalog, parts]);

  const dayOptions = useMemo(() => {
    if (!parts || !catalog) return [];
    const epoch = unixToAestParts(catalog.epochUnix);
    const tip = unixToAestParts(catalog.tipUnix);
    const daysInMonth = new Date(parts.year, parts.month, 0).getDate();
    const days: { value: number; label: string }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      if (
        parts.year === epoch.year &&
        parts.month === epoch.month &&
        d < epoch.day
      ) {
        continue;
      }
      if (
        parts.year === tip.year &&
        parts.month === tip.month &&
        d > tip.day
      ) {
        continue;
      }
      days.push({ value: d, label: String(d) });
    }
    return days;
  }, [parts, catalog]);

  const hourOptions = useMemo(() => {
    if (!parts || !catalog) {
      return Array.from({ length: 24 }, (_, i) => ({
        value: i,
        label: `${String(i).padStart(2, "0")}:00`,
      }));
    }
    const epoch = unixToAestParts(catalog.epochUnix);
    const tip = unixToAestParts(catalog.tipUnix);
    const hours: { value: number; label: string }[] = [];
    for (let h = 0; h < 24; h++) {
      if (
        parts.year === epoch.year &&
        parts.month === epoch.month &&
        parts.day === epoch.day &&
        h < epoch.hour
      ) {
        continue;
      }
      if (
        parts.year === tip.year &&
        parts.month === tip.month &&
        parts.day === tip.day &&
        h > tip.hour
      ) {
        continue;
      }
      hours.push({
        value: h,
        label: `${String(h).padStart(2, "0")}:00`,
      });
    }
    return hours;
  }, [parts, catalog]);

  const minuteOptions = useMemo(() => {
    if (!parts || !catalog) {
      return Array.from({ length: 6 }, (_, i) => ({
        value: i * 10,
        label: String(i * 10).padStart(2, "0"),
      }));
    }
    const epoch = unixToAestParts(catalog.epochUnix);
    const tip = unixToAestParts(catalog.tipUnix);
    const mins: { value: number; label: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const minute = i * 10;
      if (
        parts.year === epoch.year &&
        parts.month === epoch.month &&
        parts.day === epoch.day &&
        parts.hour === epoch.hour &&
        minute < epoch.minute
      ) {
        continue;
      }
      if (
        parts.year === tip.year &&
        parts.month === tip.month &&
        parts.day === tip.day &&
        parts.hour === tip.hour &&
        minute > tip.minute
      ) {
        continue;
      }
      mins.push({ value: minute, label: String(minute).padStart(2, "0") });
    }
    return mins;
  }, [parts, catalog]);

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
            <span>Strike style</span>
            <div
              className="inline-flex rounded-full border border-white/15 bg-black/30 p-0.5"
              role="group"
              aria-label="Lightning strike style"
            >
              <button
                type="button"
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                  !mapSettings.lightningBolts
                    ? "bg-[var(--cyan)] text-[#041018]"
                    : "text-white/65 hover:text-white",
                )}
                aria-pressed={!mapSettings.lightningBolts}
                onClick={() =>
                  setMapSettings((s) => ({ ...s, lightningBolts: false }))
                }
              >
                Crosshairs
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                  mapSettings.lightningBolts
                    ? "bg-[var(--cyan)] text-[#041018]"
                    : "text-white/65 hover:text-white",
                )}
                aria-pressed={mapSettings.lightningBolts}
                onClick={() =>
                  setMapSettings((s) => ({ ...s, lightningBolts: true }))
                }
              >
                Icons
              </button>
            </div>
          </div>
          <div className="space-y-1.5 text-sm text-white">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="archive-lightning-icon-scale">Icon size</label>
              <span className="tabular-nums text-xs text-white/55">
                {Math.round(
                  clampLightningIconScale(mapSettings.lightningIconScale) * 100,
                )}
                %
              </span>
            </div>
            <input
              id="archive-lightning-icon-scale"
              type="range"
              min={LIGHTNING_ICON_SCALE_MIN}
              max={LIGHTNING_ICON_SCALE_MAX}
              step={LIGHTNING_ICON_SCALE_STEP}
              value={clampLightningIconScale(mapSettings.lightningIconScale)}
              onChange={(e) =>
                setMapSettings((s) => ({
                  ...s,
                  lightningIconScale: clampLightningIconScale(
                    Number(e.target.value),
                  ),
                }))
              }
              className="w-full accent-[var(--cyan)]"
              aria-label="Lightning crosshair or bolt icon size"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-white">
            <span>Synoptic</span>
            <Toggle
              on={showSynoptic}
              onChange={setShowSynoptic}
              label="Pressure patterns"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-white">
            <span>Weather stations</span>
            <Toggle
              on={showStations}
              onChange={setShowStations}
              label="Weather stations"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-white">
            <span>Colour station values</span>
            <Toggle
              on={mapSettings.stationColorValues}
              onChange={(on) =>
                setMapSettings((s) => ({ ...s, stationColorValues: on }))
              }
              label="Colour station values"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-white/45">
            {showLightning
              ? lightningLoading && lightning.length === 0
                ? "Loading lightning strikes…"
                : `${Math.max(lightningTotal, lightning.length).toLocaleString()} strikes in loop window.`
              : "Lightning off."}{" "}
            Frames every {ARCHIVE_STEP_SEC / 60} minutes
            {regionId === "national" ? " (national)" : ` (${region.short})`}.
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
              mode="Static"
              regionId={regionId}
              showRadarOverlay={false}
              frameImageUrl={activeFrame?.imageUrl ?? null}
              frameImageFallbackUrl={
                activeFrame && regionId === "national"
                  ? satelliteFrameProxyUrl(product, activeFrame.time, {
                      region: "national",
                    })
                  : null
              }
              frameImageBounds={
                activeFrame?.imageBounds ?? region.bounds ?? GIBS_AU_BOUNDS
              }
              frameKey={
                activeFrame
                  ? `archive-${product}-${regionId}`
                  : "archive-empty"
              }
              frameOpacity={1}
              frameAlt={`${satProductMeta.label} archive · ${region.label}`}
              mapSettings={mapSettings}
              showLightning={showLightning}
              lightningStrikes={lightning}
              lightningReferenceTime={activeTime}
              lightningTimelineStart={loopStartUnix}
              lightningTimelineEnd={loopEndUnix ?? activeTime}
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
              showStations={showStations}
              stations={weatherStations}
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
                frameIndexRef.current = idx;
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
