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
| `/risk` | BoM thunderstorm forecast charts (Day 1–3) on the national map |
| `/risk/admin` | Upload official BoM Day 1–3 thunderstorm graphics |
| `/api/weather/risk` | Day 1–3 chart catalog + BoM legend |
| `/api/weather/risk-image` | Proxied BoM chart image (`?day=1\|2\|3`) |

BoM does not expose a public CDN for categorical thunderstorm forecast sheets (they go to registered / emergency-service channels). `/risk` displays those official graphics via admin upload (a sample NSW Day 1 chart is seeded for local demo).

**Warning categories:** Critical (very dangerous severe thunderstorm / severe weather) · Severe (severe thunderstorm / severe weather; major flood warnings) · Moderate (moderate/minor flood warnings; major/moderate flood watches) · Minor (minor flood watches; marine wind warnings).

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` if using `/risk/admin`. Production outlook storage needs Vercel Blob (`BLOB_READ_WRITE_TOKEN` or store OIDC).

## Stack

Next.js (App Router), TypeScript, Tailwind, shadcn/ui, Leaflet, Vercel Blob (for `/risk` uploads).

## Synoptic data

- **Isobars / H–L:** GFS mean sea-level pressure via Open-Meteo (true lon/lat).
- **Fronts:** BoM colour MSLP analysis (`IDY00030`, 00/06/12/18 UTC). Front geometry is vectorised from the meteorologist-drawn chart palette (blue cold/trough, red warm, purple occluded) and georeferenced to the national map frame.
