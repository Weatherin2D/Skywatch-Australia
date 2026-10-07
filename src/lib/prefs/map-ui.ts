/**
 * Persist map overlays, settings, and view prefs per page (localStorage).
 * Home, Radar, and Satellite each keep their own slot. Shareable URL query
 * params still win when present.
 */

import {
  DEFAULT_MAP_REGION,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_RADAR_MAP_SETTINGS,
  DEFAULT_RADAR_WEATHER_LAYERS,
  DEFAULT_WEATHER_LAYERS,
  MAP_MODES,
  MAP_REGIONS,
  MAP_SETTINGS,
  WEATHER_LAYERS,
  clampLightningIconScale,
  type LayerId,
  type MapMode,
  type MapRegionId,
  type MapSettingId,
  type MapSettingsState,
} from "@/components/home/mock-data";
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SATELLITE_PRODUCT,
  PLAYBACK_SPEEDS,
  SATELLITE_PRODUCTS,
  type PlaybackSpeedId,
  type SatelliteProductId,
} from "@/lib/weather/maps";

/** Bump when storage shape / defaults change. */
const STORAGE_KEY = "skywatch.map-ui.v4";
/** Previous single-blob key — migrated into home + satellite once. */
const LEGACY_STORAGE_KEY = "skywatch.map-ui.v3";

export type MapPageId = "home" | "radar" | "satellite";

export type MapUiPrefs = {
  layers: Record<LayerId, boolean>;
  mapSettings: MapSettingsState;
  mode: MapMode;
  regionId: MapRegionId;
  satProduct: SatelliteProductId;
  playbackSpeed: PlaybackSpeedId;
  chaseEnabled: boolean;
};

type StoredMapUi = Partial<Record<MapPageId, Partial<MapUiPrefs>>>;

const LAYER_IDS = WEATHER_LAYERS.map((l) => l.id);
const SETTING_IDS = MAP_SETTINGS.map((s) => s.id);
const REGION_IDS = new Set(MAP_REGIONS.map((r) => r.id));
const MODE_IDS = new Set<string>(MAP_MODES);
const PRODUCT_IDS = new Set(SATELLITE_PRODUCTS.map((p) => p.id));
const SPEED_IDS = new Set(PLAYBACK_SPEEDS.map((s) => s.id));
const PAGE_IDS: MapPageId[] = ["home", "radar", "satellite"];

export function defaultsForMapPage(page: MapPageId): MapUiPrefs {
  if (page === "radar") {
    return {
      layers: { ...DEFAULT_RADAR_WEATHER_LAYERS },
      mapSettings: { ...DEFAULT_RADAR_MAP_SETTINGS },
      mode: "Map",
      regionId: DEFAULT_MAP_REGION,
      satProduct: DEFAULT_SATELLITE_PRODUCT,
      playbackSpeed: DEFAULT_PLAYBACK_SPEED,
      chaseEnabled: true,
    };
  }
  // Home + Satellite share the same starting defaults, then diverge in storage.
  return {
    layers: { ...DEFAULT_WEATHER_LAYERS },
    mapSettings: { ...DEFAULT_MAP_SETTINGS },
    mode: "Satellite",
    regionId: DEFAULT_MAP_REGION,
    satProduct: DEFAULT_SATELLITE_PRODUCT,
    playbackSpeed: DEFAULT_PLAYBACK_SPEED,
    chaseEnabled: false,
  };
}

/** @deprecated Use defaultsForMapPage("home") — kept for archive / call sites. */
export const DEFAULT_MAP_UI_PREFS: MapUiPrefs = defaultsForMapPage("home");

function parseLayers(
  raw: unknown,
  fallback: Record<LayerId, boolean>,
): Record<LayerId, boolean> {
  const out = { ...fallback };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const id of LAYER_IDS) {
    if (typeof obj[id] === "boolean") out[id] = obj[id];
  }
  return out;
}

function parseMapSettings(
  raw: unknown,
  fallback: MapSettingsState,
): MapSettingsState {
  const out: MapSettingsState = { ...fallback };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const id of SETTING_IDS) {
    if (typeof obj[id] === "boolean") {
      out[id as MapSettingId] = obj[id];
    }
  }
  if (typeof obj.lightningIconScale === "number") {
    out.lightningIconScale = clampLightningIconScale(obj.lightningIconScale);
  }
  return out;
}

function parsePagePrefs(
  raw: Partial<MapUiPrefs> | undefined,
  page: MapPageId,
): MapUiPrefs {
  const defaults = defaultsForMapPage(page);
  if (!raw || typeof raw !== "object") return defaults;
  const mode =
    typeof raw.mode === "string" && MODE_IDS.has(raw.mode)
      ? (raw.mode as MapMode)
      : defaults.mode;
  const regionId =
    typeof raw.regionId === "string" && REGION_IDS.has(raw.regionId)
      ? (raw.regionId as MapRegionId)
      : defaults.regionId;
  const satProduct =
    typeof raw.satProduct === "string" && PRODUCT_IDS.has(raw.satProduct)
      ? (raw.satProduct as SatelliteProductId)
      : defaults.satProduct;
  const playbackSpeed =
    typeof raw.playbackSpeed === "string" && SPEED_IDS.has(raw.playbackSpeed)
      ? (raw.playbackSpeed as PlaybackSpeedId)
      : defaults.playbackSpeed;
  return {
    layers: parseLayers(raw.layers, defaults.layers),
    mapSettings: parseMapSettings(raw.mapSettings, defaults.mapSettings),
    mode: page === "radar" ? "Map" : page === "satellite" ? "Satellite" : mode,
    regionId,
    satProduct,
    playbackSpeed,
    chaseEnabled:
      typeof raw.chaseEnabled === "boolean"
        ? raw.chaseEnabled
        : defaults.chaseEnabled,
  };
}

function readStore(): StoredMapUi {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredMapUi;
      return parsed && typeof parsed === "object" ? parsed : {};
    }

    // One-time migrate v3 single-blob → home + satellite slots.
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return {};
    const parsed = JSON.parse(legacy) as Partial<MapUiPrefs>;
    const home = parsePagePrefs(parsed, "home");
    const satellite = parsePagePrefs(parsed, "satellite");
    const migrated: StoredMapUi = { home, satellite };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
}

export function readMapUiPrefs(page: MapPageId = "home"): MapUiPrefs {
  if (typeof window === "undefined") return defaultsForMapPage(page);
  try {
    const store = readStore();
    return parsePagePrefs(store[page], page);
  } catch {
    return defaultsForMapPage(page);
  }
}

export function writeMapUiPrefs(page: MapPageId, prefs: MapUiPrefs): void {
  if (typeof window === "undefined") return;
  try {
    const store = readStore();
    const next: StoredMapUi = { ...store, [page]: prefs };
    // Ensure all pages exist so a partial write never drops siblings.
    for (const id of PAGE_IDS) {
      if (!next[id]) next[id] = defaultsForMapPage(id);
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

/** Archive page overlays / cartography / loop prefs. */
const ARCHIVE_KEY = "skywatch.archive-ui.v1";

export type ArchiveUiPrefs = {
  showLightning: boolean;
  showSynoptic: boolean;
  showStations: boolean;
  mapSettings: MapSettingsState;
  product: SatelliteProductId;
  regionId: MapRegionId;
  loopHours: number;
  speedId: PlaybackSpeedId;
};

export const DEFAULT_ARCHIVE_UI_PREFS: ArchiveUiPrefs = {
  showLightning: true,
  showSynoptic: true,
  showStations: false,
  mapSettings: { ...DEFAULT_MAP_SETTINGS },
  product: DEFAULT_SATELLITE_PRODUCT,
  regionId: DEFAULT_MAP_REGION,
  loopHours: 6,
  speedId: DEFAULT_PLAYBACK_SPEED,
};

export function readArchiveUiPrefs(): ArchiveUiPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_ARCHIVE_UI_PREFS };
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return { ...DEFAULT_ARCHIVE_UI_PREFS };
    const parsed = JSON.parse(raw) as Partial<ArchiveUiPrefs>;
    const product =
      typeof parsed.product === "string" && PRODUCT_IDS.has(parsed.product)
        ? (parsed.product as SatelliteProductId)
        : DEFAULT_ARCHIVE_UI_PREFS.product;
    const regionId =
      typeof parsed.regionId === "string" && REGION_IDS.has(parsed.regionId)
        ? (parsed.regionId as MapRegionId)
        : DEFAULT_ARCHIVE_UI_PREFS.regionId;
    const speedId =
      typeof parsed.speedId === "string" && SPEED_IDS.has(parsed.speedId)
        ? (parsed.speedId as PlaybackSpeedId)
        : DEFAULT_ARCHIVE_UI_PREFS.speedId;
    const loopHours =
      typeof parsed.loopHours === "number" &&
      Number.isFinite(parsed.loopHours) &&
      parsed.loopHours > 0
        ? Math.min(48, Math.max(1, Math.round(parsed.loopHours)))
        : DEFAULT_ARCHIVE_UI_PREFS.loopHours;
    return {
      showLightning:
        typeof parsed.showLightning === "boolean"
          ? parsed.showLightning
          : DEFAULT_ARCHIVE_UI_PREFS.showLightning,
      showSynoptic:
        typeof parsed.showSynoptic === "boolean"
          ? parsed.showSynoptic
          : DEFAULT_ARCHIVE_UI_PREFS.showSynoptic,
      showStations:
        typeof parsed.showStations === "boolean"
          ? parsed.showStations
          : DEFAULT_ARCHIVE_UI_PREFS.showStations,
      mapSettings: parseMapSettings(
        parsed.mapSettings,
        DEFAULT_ARCHIVE_UI_PREFS.mapSettings,
      ),
      product,
      regionId,
      loopHours,
      speedId,
    };
  } catch {
    return { ...DEFAULT_ARCHIVE_UI_PREFS };
  }
}

export function writeArchiveUiPrefs(prefs: ArchiveUiPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
