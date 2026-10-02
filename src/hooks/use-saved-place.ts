"use client";

import { useEffect, useState } from "react";
import {
  readSavedPlace,
  subscribeSavedPlace,
  writeSavedPlace,
  regionIdForState,
  type SavedPlace,
} from "@/lib/prefs/location";
import type { BomLocation } from "@/lib/weather/location-forecast";

export function useSavedPlace() {
  const [place, setPlace] = useState<SavedPlace | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPlace(readSavedPlace());
    setReady(true);
    return subscribeSavedPlace(setPlace);
  }, []);

  async function saveFromBomLocation(loc: BomLocation) {
    const res = await fetch(
      `/api/weather/forecast/${encodeURIComponent(loc.geohash)}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error("Could not resolve location");
    const json = (await res.json()) as {
      location: {
        latitude: number | null;
        longitude: number | null;
        name: string;
        state: string;
        geohash: string;
      };
    };
    const lat = json.location.latitude;
    const lon = json.location.longitude;
    if (lat == null || lon == null) throw new Error("No coordinates");
    const next: SavedPlace = {
      geohash: json.location.geohash || loc.geohash,
      name: json.location.name,
      state: json.location.state,
      lat,
      lon,
      regionId: regionIdForState(json.location.state),
    };
    writeSavedPlace(next);
    setPlace(next);
    return next;
  }

  async function saveFromGeolocation() {
    if (!navigator.geolocation) {
      throw new Error("Geolocation is not available in this browser.");
    }
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 60_000,
      });
    });
    const { latitude, longitude } = pos.coords;
    // BoM search doesn't take lat/lon — use OpenStreetMap reverse then BoM search.
    const rev = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
      {
        headers: { Accept: "application/json" },
      },
    );
    let query = "";
    if (rev.ok) {
      const j = (await rev.json()) as {
        address?: { suburb?: string; town?: string; city?: string; state?: string };
      };
      query =
        j.address?.suburb ||
        j.address?.town ||
        j.address?.city ||
        "";
    }
    if (!query) {
      // Fall back: pick nearest capital by haversine from known list.
      const capitals = [
        { name: "Sydney", state: "NSW", geohash: "r3gx2sp", lat: -33.87, lon: 151.21 },
        { name: "Melbourne", state: "VIC", geohash: "r1r0fup", lat: -37.81, lon: 144.96 },
        { name: "Brisbane", state: "QLD", geohash: "r7hgdmr", lat: -27.47, lon: 153.03 },
        { name: "Perth", state: "WA", geohash: "qd66hrm", lat: -31.95, lon: 115.86 },
        { name: "Adelaide", state: "SA", geohash: "r1f93ck", lat: -34.93, lon: 138.6 },
        { name: "Hobart", state: "TAS", geohash: "r22u080", lat: -42.88, lon: 147.33 },
        { name: "Canberra", state: "ACT", geohash: "r3dp5hh", lat: -35.28, lon: 149.13 },
        { name: "Darwin", state: "NT", geohash: "qvv117s", lat: -12.46, lon: 130.84 },
      ];
      let best = capitals[0]!;
      let bestD = Infinity;
      for (const c of capitals) {
        const d =
          (c.lat - latitude) ** 2 + (c.lon - longitude) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const next: SavedPlace = {
        geohash: best.geohash,
        name: best.name,
        state: best.state,
        lat: latitude,
        lon: longitude,
        regionId: regionIdForState(best.state),
      };
      writeSavedPlace(next);
      setPlace(next);
      return next;
    }

    const search = await fetch(
      `/api/weather/locations?q=${encodeURIComponent(query)}`,
      { cache: "no-store" },
    );
    if (!search.ok) throw new Error("Location search failed");
    const data = (await search.json()) as {
      locations: BomLocation[];
    };
    const hit = data.locations?.[0];
    if (!hit) throw new Error("No nearby BoM location found.");
    return saveFromBomLocation(hit);
  }

  return {
    place,
    ready,
    saveFromBomLocation,
    saveFromGeolocation,
    setPlace: (p: SavedPlace) => {
      writeSavedPlace(p);
      setPlace(p);
    },
  };
}
