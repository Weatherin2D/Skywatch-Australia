# SkyWatch Australia

Professional Australian weather site — radar, forecasts, severe weather, and deeper insight.

**Local:** `npm run dev` → [http://127.0.0.1:43127](http://127.0.0.1:43127)

**Production:** [https://skywatchaustralia.vercel.app](https://skywatchaustralia.vercel.app) (also [ausrisk.vercel.app](https://ausrisk.vercel.app)). `skywatch.vercel.app` is already taken on another Vercel account and cannot be assigned to this project until that owner removes it.

## Current product surface

| Route | Status |
|-------|--------|
| `/` | SkyWatch homepage — hero, location-aware BoM panels, Himawari loops, shareable map links, overlays, storm activity, model comparison, upper air |
| `/radar` | National map focused on rain radar + lightning overlays (URL-synced) |
| `/satellite` | Himawari satellite loops (IR, visible, shortwave, air mass, dust, convection, ash, night microphysics) |
| `/models` | Multi-day ECMWF / ICON / GFS comparison (Open-Meteo) |
| `/climate` | 14–16 day temp/rain guidance + links to official BoM seasonal products |
| `/hazards` | UV strip, fire danger / FWI guidance, marine waves (Open-Meteo Marine) |
| `/forecast` | Live BoM location forecasts — search any suburb/town/postcode |
| `/forecast/[geohash]` | Direct forecast for a BoM location (incl. 24–48h rain timeline) |
| `/warnings` | Live BoM warnings + optional browser Notification alerts (client-side) |
| `/risk` | MetEye thunderstorm risk map for the full MetEye horizon |
| `/more` | Secondary tools + mobile install hint (PWA) |
| `/api/weather/maps` | Satellite frame catalog (`?all=1` or `?product=…`) via NASA GIBS + SSEC RealEarth |
| `/api/weather/frame` | Proxied/cached full-frame satellite imagery for smooth playback |
| `/api/weather/lightning` | Blitzortung live (WS/MQTT) + LightningMaps Mercator PNG backfill |
| `/api/weather/storm-activity` | Lightning hotspot summary for Storm Tracker |
| `/api/weather/models` | Multi-model comparison (`days=1..7`) via Open-Meteo |
| `/api/weather/climate` | Extended outlook guidance via Open-Meteo ensemble/forecast |
| `/api/weather/hazards` | UV / fire / marine snapshot for a geohash |
| `/api/weather/upper-air` | CAPE/CIN/shear + temp profile (Open-Meteo pressure levels) |
| `/api/weather/synoptic` | Georeferenced MSLP isobars + H/L (GFS) and fronts from BoM IDY00030 |
| `/api/weather/synoptic/frame` | GeoJSON MSLP + BoM fronts for a valid time |
| `/api/weather/warnings` | Live BoM warning list (category-ranked); `/api/weather/warnings/:id` for detail |
| `/api/weather/locations` | BoM location search (`?q=`) |
| `/api/weather/forecast` | BoM daily + hourly + observations (`?geohash=` / `/:geohash` / `?region=`) |
| `/api/weather/capitals` | Capital-city observation/forecast snapshots |
| `/api/weather/risk` | Live MetEye thunderstorm risk catalog (~7 days) |
| `/api/forecast` | MetEye thunderstorm outlook used by `/risk` |

`/risk` uses only the official BoM MetEye thunderstorm layer (`IDZ73094`) — Chance (teal) / Likely (red) — for the full MetEye horizon (~7 days). Each day shows the same 3-hourly frame MetEye displays for that period.

**Warning categories:** Critical (very dangerous severe thunderstorm / severe weather) · Severe (severe thunderstorm / severe weather; major flood warnings) · Moderate (flood warnings (moderate, minor); flood watches (major, moderate)) · Minor (flood watches (minor); marine wind warnings).

**Local preferences (no auth/DB):** saved place and warning-alert settings live in `localStorage`. Map view is shareable via query params (`region`, `mode`, `radar`, `lightning`, `synoptic`, `product`).

**PWA:** web manifest + light service worker caches the shell and last successful radar/satellite frame responses for an offline “last view”.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Stack

Next.js (App Router), TypeScript, Tailwind, shadcn/ui, Leaflet.

## Synoptic data

- **Isobars / H–L:** GFS mean sea-level pressure via Open-Meteo (true lon/lat).
- **Fronts:** BoM colour MSLP analysis (`IDY00030`, 00/06/12/18 UTC). Front geometry is vectorised from the meteorologist-drawn chart palette (blue cold/trough, red warm, purple occluded) and georeferenced to the national map frame.
