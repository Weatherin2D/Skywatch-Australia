/**
 * Persist map overlays, settings, and view prefs across visits (localStorage).
 * Shareable URL query params still win when present.
 */

import {
  DEFAULT_MAP_REGION,
  DEFAULT_MAP_SETTINGS,
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

/** Bump when default overlays/settings change so visitors pick up new defaults. */
const STORAGE_KEY = "skywatch.map-ui.v2";

export type MapUiPrefs = {
  layers: Record<LayerId, boolean>;
  mapSettings: MapSettingsState;
  mode: MapMode;
  regionId: MapRegionId;
  satProduct: SatelliteProductId;
  playbackSpeed: PlaybackSpeedId;
  chaseEnabled: boolean;
};

const LAYER_IDS = WEATHER_LAYERS.map((l) => l.id);
const SETTING_IDS = MAP_SETTINGS.map((s) => s.id);
const REGION_IDS = new Set(MAP_REGIONS.map((r) => r.id));
const MODE_IDS = new Set<string>(MAP_MODES);
const PRODUCT_IDS = new Set(SATELLITE_PRODUCTS.map((p) => p.id));
const SPEED_IDS = new Set(PLAYBACK_SPEEDS.map((s) => s.id));

export const DEFAULT_MAP_UI_PREFS: MapUiPrefs = {
  layers: { ...DEFAULT_WEATHER_LAYERS },
  mapSettings: { ...DEFAULT_MAP_SETTINGS },
  mode: "Satellite",
  regionId: DEFAULT_MAP_REGION,
  satProduct: DEFAULT_SATELLITE_PRODUCT,
  playbackSpeed: DEFAULT_PLAYBACK_SPEED,
  chaseEnabled: false,
};

function parseLayers(raw: unknown): Record<LayerId, boolean> {
  const out = { ...DEFAULT_WEATHER_LAYERS };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const id of LAYER_IDS) {
    if (typeof obj[id] === "boolean") out[id] = obj[id];
  }
  return out;
}

function parseMapSettings(raw: unknown): MapSettingsState {
  const out: MapSettingsState = { ...DEFAULT_MAP_SETTINGS };
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

export function readMapUiPrefs(): MapUiPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_MAP_UI_PREFS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MAP_UI_PREFS };
    const parsed = JSON.parse(raw) as Partial<MapUiPrefs>;
    const mode =
      typeof parsed.mode === "string" && MODE_IDS.has(parsed.mode)
        ? (parsed.mode as MapMode)
        : DEFAULT_MAP_UI_PREFS.mode;
    const regionId =
      typeof parsed.regionId === "string" && REGION_IDS.has(parsed.regionId)
        ? (parsed.regionId as MapRegionId)
        : DEFAULT_MAP_UI_PREFS.regionId;
    const satProduct =
      typeof parsed.satProduct === "string" &&
      PRODUCT_IDS.has(parsed.satProduct)
        ? (parsed.satProduct as SatelliteProductId)
        : DEFAULT_MAP_UI_PREFS.satProduct;
    const playbackSpeed =
      typeof parsed.playbackSpeed === "string" &&
      SPEED_IDS.has(parsed.playbackSpeed)
        ? (parsed.playbackSpeed as PlaybackSpeedId)
        : DEFAULT_MAP_UI_PREFS.playbackSpeed;
    return {
      layers: parseLayers(parsed.layers),
      mapSettings: parseMapSettings(parsed.mapSettings),
      mode,
      regionId,
      satProduct,
      playbackSpeed,
      chaseEnabled: Boolean(parsed.chaseEnabled),
    };
  } catch {
    return { ...DEFAULT_MAP_UI_PREFS };
  }
}

export function writeMapUiPrefs(prefs: MapUiPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
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
      mapSettings: parseMapSettings(parsed.mapSettings),
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
