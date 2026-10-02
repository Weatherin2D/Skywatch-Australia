# SkyWatch Australia

Professional Australian weather site — radar, forecasts, severe weather, and deeper insight.

**Local:** `npm run dev` → [http://127.0.0.1:43127](http://127.0.0.1:43127)

**Production:** [https://skywatchaustralia.vercel.app](https://skywatchaustralia.vercel.app) (also [ausrisk.vercel.app](https://ausrisk.vercel.app)). `skywatch.vercel.app` is already taken on another Vercel account and cannot be assigned to this project until that owner removes it.

## Current product surface

| Route | Status |
|-------|--------|
| `/` | SkyWatch homepage — hero, live BoM forecasts/warnings, Himawari loops, overlays, storm activity, model comparison, upper air |
| `/radar` | National map focused on rain radar + lightning overlays |
| `/satellite` | Himawari satellite loops (infrared / visible / air mass) |
| `/models` | Models workspace stub (coming soon) |
| `/climate` | Climate outlook stub (coming soon) |
| `/forecast` | Live BoM location forecasts — search any suburb/town/postcode |
| `/forecast/[geohash]` | Direct forecast for a BoM location |
| `/warnings` | Live BoM warnings by severity and state |
| `/risk` | Day 1–3 convective risk map, updated live from BoM |
| `/api/weather/maps` | Satellite frame catalog (`?all=1` or `?product=…`) via NASA GIBS + SSEC RealEarth |
| `/api/weather/frame` | Proxied/cached full-frame satellite imagery for smooth playback |
| `/api/weather/lightning` | Blitzortung live (WS/MQTT) + LightningMaps Mercator PNG backfill |
| `/api/weather/storm-activity` | Lightning hotspot summary for Storm Tracker |
| `/api/weather/models` | Multi-model day comparison (ECMWF / ICON / GFS via Open-Meteo) |
| `/api/weather/upper-air` | CAPE/CIN/shear + temp profile (Open-Meteo pressure levels) |
| `/api/weather/synoptic` | Georeferenced MSLP isobars + H/L (GFS) and fronts from BoM IDY00030 |
| `/api/weather/synoptic/frame` | GeoJSON MSLP + BoM fronts for a valid time |
| `/api/weather/warnings` | Live BoM warning list (category-ranked); `/api/weather/warnings/:id` for detail |
| `/api/weather/locations` | BoM location search (`?q=`) |
| `/api/weather/forecast` | BoM daily + hourly + observations (`?geohash=` / `/:geohash` / `?region=`) |
| `/api/weather/capitals` | Capital-city observation/forecast snapshots |
| `/api/weather/risk` | Live Day 1–3 convective risk catalog |
| `/api/forecast` | Day 1–3 convective risk GeoJSON used by `/risk` |

Risk sources (official BoM only — no town-forecast synthesis):

- **National / Day 3:** MetEye thunderstorm layer `IDZ73094` (Chance teal · Likely red), daily max of 3-hourly frames.
- **State Day 1–2:** BoM Thunderstorm Forecast charts (`ID*21031` / `ID*21032`) when published (e.g. Victoria IDV21031), shown as the official product sheet with the 4-category convective key.

**Warning categories:** Critical (very dangerous severe thunderstorm / severe weather) · Severe (severe thunderstorm / severe weather; major flood warnings) · Moderate (flood warnings (moderate, minor); flood watches (major, moderate)) · Minor (flood watches (minor); marine wind warnings).

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
