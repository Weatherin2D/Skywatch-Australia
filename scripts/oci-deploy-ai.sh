#!/usr/bin/env bash
# Deploy SkyWatch AI sidecar on an OCI Ubuntu VM (run ON the VM).
# Prereq: scripts/oci-bootstrap.sh already ran (Docker installed).
#
#   cd /opt/skywatch   # or wherever the repo lives
#   export SKYWATCH_AI_API_KEY=$(openssl rand -hex 24)
#   # optional: export SKYWATCH_DOMAIN=ai.yourdomain.com
#   bash scripts/oci-deploy-ai.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null; then
  echo "Docker missing. Run: sudo bash scripts/oci-bootstrap.sh"
  exit 1
fi

if [[ -z "${SKYWATCH_AI_API_KEY:-}" ]]; then
  SKYWATCH_AI_API_KEY="$(openssl rand -hex 24)"
  echo "Generated SKYWATCH_AI_API_KEY (save this):"
  echo "  $SKYWATCH_AI_API_KEY"
fi

# Persist for compose / restarts
umask 077
{
  echo "SKYWATCH_AI_API_KEY=${SKYWATCH_AI_API_KEY}"
  echo "SKYWATCH_DOMAIN=${SKYWATCH_DOMAIN:-}"
  echo "CADDY_EMAIL=${CADDY_EMAIL:-admin@localhost}"
} > .env.ai
chmod 600 .env.ai

echo "Building + starting skywatch-ai + caddy…"
docker compose --env-file .env.ai -f docker-compose.ai.yml up -d --build

echo
echo "Waiting for health…"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1/health >/dev/null 2>&1; then
    echo "OK — http://127.0.0.1/health"
    curl -fsS http://127.0.0.1/health || true
    echo
    echo "Public: open http://<VM_PUBLIC_IP>/health (OCI security list must allow 80/443)."
    echo "Vercel env:"
    echo "  SKYWATCH_AI_URL=http://<VM_PUBLIC_IP>   # or https://\$SKYWATCH_DOMAIN"
    echo "  SKYWATCH_AI_API_KEY=${SKYWATCH_AI_API_KEY}"
    exit 0
  fi
  sleep 3
done

echo "Health check timed out. Logs:"
docker compose -f docker-compose.ai.yml logs --tail=80
exit 1
