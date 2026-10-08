#!/usr/bin/env bash
# Run once on a fresh Oracle Cloud Ubuntu VM (Always Free Ampere A1 or AMD micro).
# Usage: curl -fsSL … | bash   OR   bash scripts/oci-bootstrap.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo: sudo bash scripts/oci-bootstrap.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

. /etc/os-release
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

# Open HTTP/HTTPS (OCI VCN security list / NSG must also allow these)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable || true

# Allow ubuntu (or opc) user to run docker
for u in ubuntu opc; do
  if id "$u" &>/dev/null; then
    usermod -aG docker "$u" || true
  fi
done

echo
echo "Docker installed. Log out/in (or newgrp docker), then:"
echo
echo "  # AI sidecar only (Next stays on Vercel Hobby):"
echo "  git clone <repo> /opt/skywatch && cd /opt/skywatch"
echo "  bash scripts/oci-deploy-ai.sh"
echo
echo "  # Full stack (app + AI + Caddy):"
echo "  cp .env.example .env   # fill KV_* + SKYWATCH_AI_API_KEY"
echo "  docker compose up -d --build"
echo
echo "OCI console checklist:"
echo "  - Shape: Ampere A1 (Always Free) ≥2 GB for torch, 6–12 GB preferred"
echo "  - VCN security list ingress: TCP 22, 80, 443 from 0.0.0.0/0"
echo
