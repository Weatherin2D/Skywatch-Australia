# AusRisk

Public Australian severe convective outlooks. The owner publishes GFC `forecast-cycle` JSON from `/admin`; visitors get a zoomable map, day tabs, and a full risk Key.

**Live:** [ausrisk.vercel.app](https://ausrisk.vercel.app)

## What’s in the repo today

| Path | Role |
|------|------|
| `src/app/page.tsx` | Public outlook (home) |
| `src/app/admin/` | Password-protected publish UI |
| `src/app/api/forecast/` | Public forecast JSON |
| `src/app/api/admin/` | Login, upload, day manage |
| `src/components/forecast/` | Map, Key, admin panel |
| `src/lib/forecast/` | Parse, day-roll, Blob/disk storage |
| `public/samples/` | Example GFC JSON |
| `data/` | Local upload store (gitignored file) |

Future marketing/info pages will sit beside these under `src/app/` (e.g. `about/page.tsx`).

## Features

- Public map (Esri light-gray basemap) with pan / scroll zoom
- Day tabs; dates roll in **Australia/Sydney** time (max **5** days)
- Key lists every risk category; **white outline** = used on the selected day
- Admin publish modes: replace slots from a file (keeps other days) or update one day
- Remove a day or wipe all
- `PLACEHOLDER` legend entries stripped on upload
- Durable storage via **Vercel Blob** in production

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

Set a long random `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` in `.env.local`.

1. Open `/admin` and sign in  
2. Upload a GFC JSON (or manage / wipe days)  
3. Choose day slot + publish mode  
4. Public map updates from `/api/forecast`

Seed local disk from the sample (optional):

```bash
npm run seed
```

Example file: `public/samples/example-forecast.json`.

## Deploy (Vercel)

Project is set up for Next.js. In Vercel env vars:

| Variable | Purpose |
|----------|---------|
| `ADMIN_PASSWORD` | Admin login |
| `ADMIN_SESSION_SECRET` | Session signing |
| `BLOB_READ_WRITE_TOKEN` or Blob store + OIDC (`BLOB_STORE_ID`) | Persist forecasts |

Without Blob, uploads work on local disk only and will not survive serverless deploys.

## Day rolling

On upload, each day is stamped to a Sydney calendar date (`today + day − 1`). On each public load, past `validDate`s drop off and remaining days are re-labelled (old Day 2 → Day 1, etc.).

## Stack

Next.js (App Router), TypeScript, Tailwind, shadcn/ui, Leaflet, Vercel Blob.
