# Deploying the SkyWatch AI sidecar

## Env

| Variable | Where | Notes |
|---|---|---|
| `SKYWATCH_AI_CHECKPOINT` | Sidecar | Default `/app/checkpoints/v1-etl.pt` in Dockerfile |
| `SKYWATCH_AI_API_KEY` | Sidecar + Next | Optional; when set, `/v1/*` needs `Authorization: Bearer …` |
| `SKYWATCH_AI_URL` | Next (Vercel / `.env.local`) | Public HTTPS origin of the sidecar |

## Railway

```bash
cd skywatch-ai
railway login   # or export RAILWAY_TOKEN=…
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

## Local + Cloudflare tunnel (smoke)

```bash
SKYWATCH_AI_API_KEY=… uvicorn serve:app --host 127.0.0.1 --port 43137
cloudflared tunnel --url http://127.0.0.1:43137
# Point SKYWATCH_AI_URL at the printed https://*.trycloudflare.com URL
```
