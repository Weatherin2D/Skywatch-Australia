# CloudCountry — GitHub Pages lite

Static Vite + React build that runs on **GitHub Pages** (no Docker, no Node server).

## Features

- Australia-centred Leaflet map
- Live **RainViewer** rain radar loop (play / scrub / opacity)
- Optional RainViewer infrared satellite tiles
- **Open-Meteo** current conditions for the eight capital cities

This is intentionally a subset of the full Next.js CloudCountry app (BoM, Himawari products, storm cells, warnings, community, etc.).

## Local

```bash
cd pages-site
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

Preview production build:

```bash
VITE_BASE=/ npm run build
npm run preview
```

## GitHub Pages

1. Make the repository **public** (required for free GitHub Pages).
2. In GitHub → **Settings → Pages**: Source = **GitHub Actions**.
3. Push to `main` (or run the **Deploy GitHub Pages** workflow manually).
4. Site URL: `https://weatherin2d.github.io/Skywatch-Australia/`

The workflow sets `VITE_BASE=/Skywatch-Australia/` so asset paths match the project site.
