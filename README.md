# SkyWatch Australia

Professional Australian weather site — radar, forecasts, severe weather, and deeper insight.

**Local:** `npm run dev` → [http://127.0.0.1:43127](http://127.0.0.1:43127)

**Production:** [https://skywatchaustralia.vercel.app](https://skywatchaustralia.vercel.app) (also [ausrisk.vercel.app](https://ausrisk.vercel.app)). `skywatch.vercel.app` is already taken on another Vercel account and cannot be assigned to this project until that owner removes it.

## Current product surface

| Route | Status |
|-------|--------|
| `/` | SkyWatch homepage — hero, near-you moment card, location-aware BoM panels, Himawari loops, shareable map links, overlays, storm activity, model comparison, upper air |
| `/satellite` | Himawari satellite loops (IR, visible, shortwave, air mass, dust, day/night microphysics) |
| `/models` | Multi-model map lab (ECMWF / ICON / GFS) — product picker, diff mode, click values, meteogram, mini Skew-T, transect cross-section |
| `/model-comparison` | Multi-day ECMWF / ICON / GFS comparison (Open-Meteo) |
| `/ensemble` | ECMWF ensemble spaghetti (2 m temp / precip) for saved place |
| `/radar` | Active Cell Tracker overlay (`?chase=1&cell=`) — scores, projected paths, details |
| `/warnings` | BoM warnings, or Automated thunderstorm cells via `?source=auto` |
| `/warnings/auto/[cellId]` | SkyWatch automated cell alert detail (score, analysis, path) |
| `/soundings` | Observed UWYO radiosondes, model Skew-T, and 3×3 model sounding boxes |
| `/climate` | 14–16 day temp/rain guidance + links to official BoM seasonal products |
| `/hazards` | UV strip, fire danger / FWI guidance, marine waves (Open-Meteo Marine) |
| `/forecast` | Live BoM location forecasts — search any suburb/town/postcode |
| `/forecast/[geohash]` | Direct forecast for a BoM location (incl. 24–48h rain timeline) |
| `/archive` | Forward-growing archive from midnight AEST today — satellite, synoptic, lightning with date/time picker |
| `/risk` | MetEye thunderstorm risk map for the full MetEye horizon |
| `/community` | Shared weather photo posts — upload, filter library, likes, comments; admin-only delete |
| `/more` | Secondary tools + mobile install hint (PWA) |
| `/api/weather/archive` | Archive catalog (epoch, products, day index) |
| `/api/weather/archive/frame` | Archived national satellite JPEG |
| `/api/weather/archive/synoptic` | Archived / on-demand synoptic GeoJSON |
| `/api/weather/archive/lightning` | Archived lightning strikes (`from`/`to`) |
| `/api/weather/archive/ingest` | Archive ingest (daily Vercel Cron + lazy on catalog visits; Hobby plan limit) |
| `/api/weather/maps` | Satellite frame catalog (`?all=1` or `?product=…`) via NASA GIBS + SSEC RealEarth |
| `/api/weather/frame` | Proxied/cached full-frame satellite imagery for smooth playback |
| `/api/weather/lightning` | Blitzortung live (WS/MQTT) + LightningMaps Mercator PNG backfill |
| `/api/weather/storm-activity` | Lightning hotspot summary for Storm Tracker |
| `/api/weather/storm-cells` | Active cells: score/100, projected paths, analysis, automated alerts[] |
| `/api/weather/models` | Multi-model comparison (`days=1..7`) via Open-Meteo |
| `/api/weather/ecmwf-map` | Model map catalog (`product`, `model=ecmwf|icon|gfs`) |
| `/api/weather/ecmwf-map/frame` | Georeferenced field PNG (`product`, `time`, `model`, optional `diff`) |
| `/api/weather/ecmwf-map/point` | Point sample / meteogram (`series=1`) for map click |
| `/api/weather/ensemble` | Ensemble member spaghetti (`lat`, `lon`, `var`) |
| `/api/weather/cross-section` | Vertical transect (`startLat/Lon`, `endLat/Lon`, `field`, `model`) |
| `/api/weather/climate` | Extended outlook guidance via Open-Meteo ensemble/forecast
| `/api/weather/hazards` | UV / fire / marine snapshot for a geohash |
| `/api/weather/upper-air` | Home panel: latest observed Sydney Airport radiosonde (UWYO) |
| `/api/weather/sounding` | Sounding profile (`mode=observed|model|box`) — UWYO BUFR or Open-Meteo levels / 3×3 box |
| `/api/weather/sounding?archive=1` | Observed UWYO inventory slots for a station (`station`, optional `year`) |
| `/api/weather/synoptic` | Georeferenced MSLP isobars + H/L (GFS) and fronts from BoM IDY00030 |
| `/api/weather/stations` | Live AU weather-station observations for station-model map overlays |
| `/api/weather/synoptic/frame` | GeoJSON MSLP + BoM fronts for a valid time |
| `/api/weather/warnings` | Live BoM warning list (category-ranked); `/api/weather/warnings/:id` for detail |
| `/api/weather/locations` | BoM location search (`?q=`) |
| `/api/weather/forecast` | BoM daily + hourly + observations (`?geohash=` / `/:geohash` / `?region=`) |
| `/api/weather/capitals` | Capital-city observation/forecast snapshots |
| `/api/weather/risk` | Live MetEye thunderstorm risk catalog (~7 days) |
| `/api/forecast` | MetEye thunderstorm outlook used by `/risk` |

`/risk` uses only the official BoM MetEye thunderstorm layer (`IDZ73094`) — Chance (teal) / Likely (red) — for the full MetEye horizon (~7 days). Each day shows the same 3-hourly frame MetEye displays for that period.

**Warning categories:** Critical (detailed severe thunderstorm; very dangerous severe thunderstorm / severe weather) · Severe (severe thunderstorm / severe weather; major flood warnings) · Moderate (flood warnings (moderate, minor); flood watches (major, moderate)) · Minor (flood watches (minor); marine wind warnings).

**Local preferences (no auth/DB):** saved place and warning-alert settings live in `localStorage`. Map view is shareable via query params (`region`, `mode`, `radar`, `lightning`, `synoptic`, `product`).

**Community:** posts (images, captions, likes, comments, dates) use durable storage so they survive deploys. Preference order: Upstash Redis (`KV_REST_API_URL` + `KV_REST_API_TOKEN`) → healthy Vercel Blob → local `/tmp` (dev only). On Vercel, mutations refuse ephemeral `/tmp` and return 503 if no durable backend is available. Likes also keep a per-browser toggle in `localStorage`. Admin delete: sign in with `COMMUNITY_ADMIN_SECRET` to show a red X on each post, then enter the secret again to confirm each delete.

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
