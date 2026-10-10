# Start CloudCountry on a Windows home PC (Docker Desktop + Compose).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env — edit it (Notepad) and set KV_REST_API_URL + KV_REST_API_TOKEN, then re-run."
  exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Install Docker Desktop first: https://www.docker.com/products/docker-desktop/"
  exit 1
}

Write-Host "Building and starting CloudCountry (app + Caddy on ports 80/443)…"
docker compose up -d --build

Write-Host ""
Write-Host "Local site:  http://127.0.0.1"
Write-Host ""
Write-Host "Public URL (Cloudflare quick tunnel — no card):"
Write-Host "  1) Install cloudflared:"
Write-Host "     winget install --id Cloudflare.cloudflared"
Write-Host "  2) Run:  cloudflared tunnel --url http://127.0.0.1:80"
Write-Host "  3) Open the https://….trycloudflare.com link it prints."
Write-Host ""
Write-Host "Keep this PC awake and Docker running. Stop with: docker compose down"
Write-Host ""
