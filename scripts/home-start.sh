#!/usr/bin/env bash
# Start CloudCountry on a home PC (Docker Compose) then print next tunnel steps.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env — edit it and set KV_REST_API_URL + KV_REST_API_TOKEN, then re-run."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Install Docker Desktop first: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

echo "Building and starting CloudCountry (app + Caddy on ports 80/443)…"
docker compose up -d --build

echo
echo "Local site:  http://127.0.0.1"
echo
echo "Public URL (Cloudflare quick tunnel — no card):"
echo "  1) Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
echo "  2) Run:  cloudflared tunnel --url http://127.0.0.1:80"
echo "  3) Use the https://….trycloudflare.com link it prints."
echo
echo "Keep this PC awake and Docker running. Stop with: docker compose down"
echo
