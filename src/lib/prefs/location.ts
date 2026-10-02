/** Saved user place for Home / Forecast / Models / Hazards. */

import type { MapRegionId } from "@/components/home/mock-data";

const STORAGE_KEY = "skywatch.place.v1";

export type SavedPlace = {
  geohash: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  regionId: MapRegionId;
};

const STATE_TO_REGION: Record<string, MapRegionId> = {
  NSW: "nsw",
  VIC: "vic",
  QLD: "qld",
  WA: "wa",
  SA: "sa",
  TAS: "tas",
  NT: "nt",
  ACT: "act",
};

export function regionIdForState(state: string): MapRegionId {
  return STATE_TO_REGION[state.toUpperCase()] ?? "national";
}

export function readSavedPlace(): SavedPlace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedPlace;
    if (
      !parsed?.geohash ||
      typeof parsed.lat !== "number" ||
      typeof parsed.lon !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSavedPlace(place: SavedPlace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(place));
    window.dispatchEvent(new CustomEvent("skywatch:place", { detail: place }));
  } catch {
    /* quota / private mode */
  }
}

export function clearSavedPlace(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("skywatch:place", { detail: null }));
  } catch {
    /* ignore */
  }
}

/** Subscribe to place changes (same tab + storage events). */
export function subscribeSavedPlace(
  cb: (place: SavedPlace | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = (e: Event) => {
    cb((e as CustomEvent<SavedPlace | null>).detail ?? readSavedPlace());
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb(readSavedPlace());
  };
  window.addEventListener("skywatch:place", onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("skywatch:place", onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
