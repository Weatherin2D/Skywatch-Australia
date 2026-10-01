# SkyWatch Australia

Professional Australian weather site — radar, forecasts, severe weather, and deeper insight.

**Local:** `npm run dev` → [http://127.0.0.1:43127](http://127.0.0.1:43127)

## Current product surface

| Route | Status |
|-------|--------|
| `/` | SkyWatch homepage — Himawari satellite loops, Map overlays (Lightning, Rain radar, Synoptic MSLP), region picker, live BoM warnings panel |
| `/warnings` | Live BoM warnings list, sorted by severity; filter by state |
| `/warnings/[id]` | Warning detail — full BoM text plus embedded maps/images |
| `/api/weather/maps` | Satellite frame catalog (`?all=1` or `?product=…`) via NASA GIBS + SSEC RealEarth |
| `/api/weather/frame` | Proxied/cached full-frame satellite imagery for smooth playback |
| `/api/weather/lightning` | Blitzortung live (WS/MQTT) + LightningMaps Mercator PNG backfill |
| `/api/weather/synoptic` | Georeferenced MSLP isobars + H/L (GFS) and fronts from BoM IDY00030 |
| `/api/weather/synoptic/frame` | GeoJSON MSLP + BoM fronts for a valid time |
| `/api/weather/warnings` | Live BoM warning list (severity-ranked); `/api/weather/warnings/:id` for detail |
| `/forecast` | Coming soon stub |
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
