# Deploying the SkyWatch AI sidecar

## Env

| Variable | Where | Notes |
|---|---|---|
| `SKYWATCH_AI_CHECKPOINT` | Sidecar | Default `/app/checkpoints/v1-etl.pt` in Dockerfile |
| `SKYWATCH_AI_API_KEY` | Sidecar + Next | Optional; when set, `/v1/*` needs `Authorization: Bearer …` |
| `SKYWATCH_AI_URL` | Next (Vercel / `.env.local`) | Public HTTPS origin of the sidecar |

## Render (preferred when Railway trial is expired)

Blueprint: repo-root [`render.yaml`](../../render.yaml). AI service = `skywatch-ai` on plan **`1c-2g`** (2 GB). Free/512 MB will OOM on torch.

```bash
# Dashboard: New → Blueprint → connect this repo → apply
# Or API with RENDER_API_KEY:
export RENDER_API_KEY=…
# Set SKYWATCH_AI_API_KEY on skywatch-ai (and the same value on Next/Vercel).
# Public URL looks like https://skywatch-ai.onrender.com
curl https://skywatch-ai.onrender.com/health
```

Cold starts on paid plans are still a few seconds; first `/v1/predict` may take longer while the model loads.

## Railway

```bash
cd skywatch-ai
railway login   # or export RAILWAY_API_TOKEN=… (workspace) / RAILWAY_TOKEN=… (project)
railway up
railway variables set SKYWATCH_AI_API_KEY=…
```

Then on Vercel: set `SKYWATCH_AI_URL` and `SKYWATCH_AI_API_KEY` (Production + Preview).

## Fly

```bash
cd skywatch-ai
flyctl deploy --config fly.toml --app skywatch-ai-au
flyctl secrets set SKYWATCH_AI_API_KEY=…
```

Requires a Fly org with billing enabled (2 GB VM).

## Oracle Cloud Always Free (recommended free durable host)

AI-only compose (Next stays on Vercel):

```bash
# On a fresh Ubuntu Ampere VM:
sudo bash scripts/oci-bootstrap.sh
# log out/in for docker group
git clone <repo> /opt/skywatch && cd /opt/skywatch
bash scripts/oci-deploy-ai.sh
```

Files: [`docker-compose.ai.yml`](../../docker-compose.ai.yml), [`Caddyfile.ai`](../../Caddyfile.ai).

OCI console: open **TCP 80 + 443** on the VCN security list / NSG. Use ≥2 GB RAM (Ampere A1 flexible).

Vercel:

```
SKYWATCH_AI_URL=http://<VM_PUBLIC_IP>   # or https://ai.yourdomain.com
SKYWATCH_AI_API_KEY=<from deploy script output>
```

## Local + Cloudflare tunnel (smoke)

```bash
SKYWATCH_AI_API_KEY=… uvicorn serve:app --host 127.0.0.1 --port 43137
cloudflared tunnel --url http://127.0.0.1:43137
# Point SKYWATCH_AI_URL at the printed https://*.trycloudflare.com URL
```
