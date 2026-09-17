# SkyWatch Australia

Professional Australian weather site — radar, forecasts, severe weather, and deeper insight.

**Live (when deployed):** Vercel project for this repo  
**Local:** `npm run dev` → [http://127.0.0.1:43127](http://127.0.0.1:43127)

## Current product surface

| Route | Status |
|-------|--------|
| `/` | SkyWatch homepage — Himawari satellite loops (Visible, Infrared, Air Mass, Water Vapor, Shortwave IR, Dust, Volcanic Ash), Map overlays (Lightning tracker, vector Synoptic MSLP), map shell, mock panels |
| `/api/weather/maps` | Satellite frame catalog (`?all=1` or `?product=…`) via NASA GIBS + SSEC RealEarth |
| `/api/weather/frame` | Proxied/cached full-frame satellite imagery for smooth playback |
| `/api/weather/lightning` | Live Blitzortung lightning strikes (AU bbox, ~3s poll, 30‑min window) |
| `/api/weather/synoptic` | Georeferenced MSLP isobars + H/L (GFS) and fronts from BoM IDY00030 |
| `/api/weather/synoptic/frame` | GeoJSON MSLP + BoM fronts for a valid time (`?time=YYYYMMDDHHMM`) |
| `/weather-map`, `/forecast`, `/severe-weather`, … | Coming soon stubs |
| `/risk` | Preserved convective outlook (former AusRisk public map) |
| `/risk/admin` | Preserved outlook admin upload |

Forecast APIs under `/api/forecast` and `/api/admin/*` still power `/risk`.

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
