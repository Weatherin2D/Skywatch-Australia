#!/usr/bin/env bash
# Run once on a fresh Google Cloud Always Free e2-micro (Ubuntu).
# Usage: sudo bash scripts/gcp-bootstrap.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo: sudo bash scripts/gcp-bootstrap.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw

# Swap — e2-micro has ~1 GB RAM; Next.js + sharp needs headroom.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

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

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable || true

if id ubuntu &>/dev/null; then
  usermod -aG docker ubuntu || true
fi

echo
echo "Docker + 2G swap ready. Log out/in (or: newgrp docker), then:"
echo "  git clone <repo> skywatch && cd skywatch"
echo "  cp .env.example .env   # fill KV_* secrets"
echo "  docker compose up -d --build"
echo
echo "Build on e2-micro can take 10–20+ minutes. Prefer building on a larger"
echo "machine and loading an image if this VM runs out of memory."
echo
