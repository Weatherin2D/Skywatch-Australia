# SkyWatch Australia

Professional Australian weather site — radar, forecasts, severe weather, and deeper insight.

**Local (full Next.js app):** `npm run dev` → [http://127.0.0.1:43127](http://127.0.0.1:43127)

**Public host (free Hobby):** Vercel — see [Vercel Hobby](#vercel-hobby-recommended) below.

**Public host (free, no Docker):** GitHub Pages lite — see below.

**Full app host (when you have budget / working Docker):** Node host or home PC + Cloudflare Tunnel.

## SkyWatch AI (soundings) — local only

Python package in [`skywatch-ai/`](skywatch-ai/). Runs as a **local sidecar** (not on Vercel Hobby). Public hosting is optional later; leave `SKYWATCH_AI_URL` unset on Vercel so production falls back to legacy thermo.

| Mode on `/soundings` | What it does |
|---|---|
| **Engine** (`engine=auto`) | Deterministic CAPE/SRH on the observed/model profile |
| **AI V1** (`engine=predict`) | Open-Meteo teacher + V1 net + engine diagnostics |
| **Legacy** | Original TypeScript thermo |

```bash
# Terminal A — sidecar
cd skywatch-ai && . .venv/bin/activate
# optional: export SKYWATCH_AI_API_KEY=…
uvicorn serve:app --host 127.0.0.1 --port 43137

# Terminal B — Next
# .env.local
SKYWATCH_AI_URL=http://127.0.0.1:43137
# SKYWATCH_AI_API_KEY=…   # only if set on the sidecar
npm run dev -- -p 43127
```

Or: `docker compose up -d --build skywatch-ai`. Details: [`skywatch-ai/README.md`](skywatch-ai/README.md).

## Vercel Hobby (recommended)

The app auto-enables a **Hobby budget** on any Vercel deploy (`VERCEL=1`):

| Cut | Why |
|-----|-----|
| Radar tiles from RainViewer CDN directly | Skips `/api/weather/radar-tile` pngjs recolour (main Active CPU burn) |
| No server-side radar/satellite warm | Background warm kept functions alive after the response |
| Lightning: no WS/MQTT timers; GeoJSON backfill only | Serverless sockets + PNG decode burned CPU |
| `maxDuration` 60s, daily archive cron only | Matches Hobby cron + Fluid limits |
| Slower client polls / lighter tile prefetch | Fewer invocations per open tab |

**Deploy on a fresh Hobby account**

1. [vercel.com](https://vercel.com) → new account → Import `Weatherin2D/Skywatch-Australia`.
2. Framework: Next.js. Leave build defaults (`npm run build`).
3. Env vars (Project → Settings → Environment Variables):

| Name | Value |
|------|--------|
| `KV_REST_API_URL` | Upstash Redis REST URL (free tier) |
| `KV_REST_API_TOKEN` | Upstash Redis REST token |
| `COMMUNITY_ADMIN_SECRET` | optional private admin delete secret |

Hobby mode is automatic — do **not** set `SKYWATCH_FULL_COMPUTE=1` unless you accept fair-use risk.

4. Deploy. Open the `*.vercel.app` URL. Check **Usage** after a day of light traffic (Active CPU should stay well under 4h).

**Trade-offs on Hobby:** radar uses RainViewer Universal Blue (not the custom SkyWatch dBZ ladder); lightning trail is thinner until the browser live socket fills it; archive grows once per day via cron plus sparse lazy ingest.

To restore full recolour/warm on a paid plan or self-host: set `SKYWATCH_FULL_COMPUTE=1` (or `SKYWATCH_RADAR_DIRECT=0` + `SKYWATCH_WARM=1`).

## GitHub Pages lite (no Docker, free)

Static map + RainViewer radar + Open-Meteo capitals. Lives in `pages-site/`.

| | |
|---|---|
| Local | `npm run dev:pages` → [http://127.0.0.1:43147](http://127.0.0.1:43147) |
| Public URL | `https://weatherin2d.github.io/Skywatch-Australia/` |

**Enable once on GitHub**

1. Make the repo **public** (required for free Pages).
2. **Settings → Pages** → Source: **GitHub Actions**.
3. Push to `main` (or Actions → **Deploy GitHub Pages** → Run workflow).

Proprietary licence still applies; a public repo only means the source is visible so Pages can serve it.

Details: [`pages-site/README.md`](pages-site/README.md).

### Run the full app on a home PC (Windows / Mac / Linux)

**Requirements:** Docker Desktop, ~4 GB free RAM for the build, PC left on while the site should be public.

**1. Get the code**

```bash
git clone https://github.com/Weatherin2D/Skywatch-Australia.git
cd Skywatch-Australia
```

**2. Secrets**

```bash
cp .env.example .env
# Edit .env — set at least:
#   KV_REST_API_URL=
#   KV_REST_API_TOKEN=
#   COMMUNITY_ADMIN_SECRET=   (optional)
```

**3. Start the site**

- Windows (PowerShell): `.\scripts\home-start.ps1`
- Mac / Linux: `bash scripts/home-start.sh`

Or: `docker compose up -d --build`  
Local URL: [http://127.0.0.1](http://127.0.0.1)

**4. Public URL (Cloudflare quick tunnel — free, no card)**

```bash
# Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
# Windows: winget install --id Cloudflare.cloudflared

cloudflared tunnel --url http://127.0.0.1:80
```

Copy the `https://….trycloudflare.com` link it prints. Keep that terminal open.

**Tips:** disable sleep while hosting; first Docker build can take several minutes; stop with `docker compose down`. For a stable hostname later (still free), create a Cloudflare account and a named tunnel pointed at `http://127.0.0.1:80`.

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
| `/archive` | Forward-growing archive (satellite, synoptic/MSLP, lightning) — durable on Upstash Redis so scrub/play survives deploys |
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

**Local preferences (no auth/DB):** saved place, warning-alert settings, and map UI prefs live in `localStorage`. Overlays (radar, lightning, synoptic, stations), cartography toggles (including radar smoothing and lightning style), mode, region, satellite product, playback speed, chase mode, and archive loop settings restore when you reopen the site. Shareable query params (`region`, `mode`, `radar`, `lightning`, `synoptic`, `product`, …) still override saved prefs when present.

**Community:** posts (images, captions, likes, comments, dates) use durable storage so they survive deploys. Preference order: Upstash Redis (`KV_REST_API_URL` + `KV_REST_API_TOKEN`) → healthy Vercel Blob → local `/tmp` (dev only). On Vercel, mutations refuse ephemeral `/tmp` and return 503 if no durable backend is available. Likes also keep a per-browser toggle in `localStorage`. Admin delete: sign in with `COMMUNITY_ADMIN_SECRET` to show a red X on each post and comment, then enter the secret again to confirm each delete.

**Community abuse controls:** each IP has a **20-minute cooldown** for publishing a post and a separate **20-minute cooldown** for comments (stored in Redis so it cannot be bypassed by refreshing or switching browsers). Likes are rate-limited per IP. Extra checks: same-origin enforcement, honeypot fields, JPEG/PNG/WebP magic-byte validation, link-spam heuristics, comment cap per post, and timing-safe admin secret comparison.

**Archive:** satellite JPEGs, synoptic GeoJSON, and lightning hours use the same Upstash Redis credentials when present (then Blob, then local `/tmp` for dev). Meta epoch is created once and kept, so the date picker can move through stored history instead of resetting to “today” on every cold start. Frame responses race a live encode against archive capture so scrub/play is not blocked on a cold persist.

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
