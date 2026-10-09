# SkyWatch AI — V1 sounding model

Implements `01_ARCHITECTURE`, `02_DATA_PIPELINE`, `03_V1_SOUNDING_MODEL`.
Contract: **neural net → atmospheric state · deterministic engine → diagnostics · evaluation through the engine.**

## Site integration

Served to SkyWatch `/soundings` via FastAPI sidecar (`serve.py`):

```bash
# Train stack (torch) + run sidecar
pip install -r requirements-train.txt
python scripts/smoke_test.py --out-dir runs/synthetic-smoke
cp runs/synthetic-smoke/ckpt.pt checkpoints/v1-synthetic.pt   # fallback only
# Prefer ETL-trained checkpoint when present:
#   python scripts/batch_etl.py --days 60 --fresh --out data/etl/au_v1
#   python scripts/train_etl.py --data data/etl/au_v1 --synthetic 1500 --steps 2500 \
#     --real-val-frac 0.2 --promote
#   python scripts/eval_holdout.py --data data/etl/au_v1 --ckpt checkpoints/v1-etl.pt
uvicorn serve:app --host 0.0.0.0 --port 43137
# Loads checkpoints/v1-etl.pt if present, else v1-synthetic.pt

# Or from repo root
docker compose up -d --build skywatch-ai
```

| Endpoint | Purpose |
|---|---|
| `GET /health` | Engine + ML readiness (no auth) |
| `POST /v1/diagnostics` | Deterministic CAPE/SRH (numpy) |
| `POST /v1/predict` | V1 neural sounding (torch + checkpoint) |

Next.js: set `SKYWATCH_AI_URL` (+ optional `SKYWATCH_AI_API_KEY`). Use **Engine** / **AI V1** / **Legacy** on `/soundings`, `/models` (mini Skew-T), and `/risk` (inspect overlay).

**AI V1 predict** uses an Open-Meteo teacher prior + radiosonde observation tokens (falls back to self-prior if the teacher fetch fails). Live predict pulls a real **9×9 neighbourhood at 0.25°** (override with `SKYWATCH_AI_SPATIAL_STEP`) plus denser teacher pressure levels matching `IN_LEVELS` — not a flat single-column prior. Promoted weights: `checkpoints/v1-etl.pt` (`etl+synth-426r-2000s`, 90d + stratified warm-season). Not an official forecast — see `metrics/holdout-metrics.json`.

**Note:** AI V1 corrects **soundings** (Skew-T / CAPE etc.). It does **not** paint the Models map rain overlay — that grid is Open-Meteo sampling in `ecmwf-map.ts`.

### Public sidecar deploy

**Preferred — Railway** (see [`railway.toml`](railway.toml)):

```bash
cd skywatch-ai
railway login   # or RAILWAY_TOKEN
railway up
# Set SKYWATCH_AI_API_KEY in Railway; mirror on Vercel (server-only):
#   SKYWATCH_AI_URL=https://<railway-host>
#   SKYWATCH_AI_API_KEY=<same secret>
```

**Fallback — Fly** ([`fly.toml`](fly.toml)): `flyctl deploy` from `skywatch-ai/` (needs a billed Fly org; 2 GB VM).

**Dev / smoke — Cloudflare quick tunnel** to a local uvicorn on `:43137` (ephemeral `*.trycloudflare.com`). Useful when Railway/Fly/Vercel env updates are blocked.

Memory ≥2 GB recommended (CPU torch). `/health` stays public; other routes require `Authorization: Bearer <key>` when `SKYWATCH_AI_API_KEY` is set.

## What is verified and what is not

| Component | Milestone | Status |
|---|---|---|
| Engine / AI V1 / Legacy on `/soundings`, `/models`, `/risk` | site | **Done** |
| V1 torch smoke + synthetic checkpoint + `/v1/predict` | 4–6 | **Done** (`SMOKE TEST PASSED`, ckpt in `checkpoints/v1-synthetic.pt`) |
| Deterministic diagnostics engine | 7 | **Tested** |
| Grid / normaliser / tokens / contract | 1–2 | **Tested** |
| Baselines + evaluation through engine | 3, 5 | **Tested** |
| Loss math + schedule | 6 | **Tested** |
| Real-data ETL (Open-Meteo hist-forecast teacher + UWYO BUFR inventory → contract samples) | 1 | **Done** — `scripts/batch_etl.py`, event_weight for CAPE/inversions |
| Train/eval on ETL+synth, promote `v1-etl.pt` | 8 | **Done** — 426 AU samples + 2000 synth; train-val T/wind/cape green |
| Holdout eval on real AU sondes | 8b | **Done** — T + cape_corr pass; wind/inversion/high-CAPE still open |
| Skill claims / calibration | 9 | **Not done** — high-CAPE MAE nan on SE holdout; inversion hit 0.38 |
| BARRA2 / ERA5 archive ETL | 1 | **Not done** — free ERA5 archive returns null pressure levels; hist-forecast IFS used |
| Public sidecar | site | **Ready** — `railway.toml` / `fly.toml` + API key; smoke via Cloudflare tunnel |

## Holdout protocol

1. Build ETL samples (`batch_etl.py`). Filenames are `{WMO}_{YYYYMMDD}_{HHMM}Z.npz`.
2. Train with `--real-val-frac 0.2` (last 20% of real files by time held out) or `--holdout-stations 94767,94610`. Synthetic samples use `--val-frac` separately and mostly stay in train.
3. After promote: `python scripts/eval_holdout.py --data data/etl/au_v1 --ckpt checkpoints/v1-etl.pt` writes `metrics/holdout-metrics.json`.
4. If holdout T/wind regress vs `checkpoints/v1-etl-prev.pt`, restore the previous checkpoint.

## First things to run
    pip install -r requirements-train.txt
    python -m unittest discover -s tests -v
    python scripts/smoke_test.py --out-dir runs/synthetic-smoke
    python scripts/batch_etl.py --days 60 --fresh --out data/etl/au_v1
    python scripts/train_etl.py --data data/etl/au_v1 --synthetic 1500 --steps 2500 --real-val-frac 0.2 --promote
    python scripts/eval_holdout.py --data data/etl/au_v1 --ckpt checkpoints/v1-etl.pt
    python scripts/compare_sounding.py sonde.csv --hemisphere S

Batch ETL uses UWYO **inventory** launch times (AU often 11/19/23Z, not 00/12). Teacher = Open-Meteo historical-forecast IFS with `wind_speed_unit=ms` (Open-Meteo defaults to km/h). `event_weight` is ×3 for SBCAPE>2000 and ×2 for inversion≥1.5 K (stage-6 oversampling).

## Engine conventions (SRH convention confirmed)
* **SRH:** `hemisphere="S"` = Bunkers left-mover with sign flipped → positive = favourable for cyclonic supercells (exact mirror of the NH definition; tested).
* **CAPE/LFC/EL = principal buoyant layer**: the contiguous positive-buoyancy layer above the LCL with the largest CAPE (layers < 0.5 J/kg ignored). CIN ≤ 0, integrated from the parcel origin to that layer's LFC (to 500 hPa if none).
* Virtual-temperature buoyancy (switch off with `virtual=False` to mimic MetPy-style CAPE), pseudo-adiabatic liquid-only ascent, heights AGL.
* Freezing level and wet-bulb zero are evaluated on a 1-hPa fine grid, so they do not depend on input vertical resolution.
* ML = lowest-100-hPa mean parcel; MU = max-θe parcel in lowest 300 hPa. NaN (never a guess) when the profile is too short for 3/6 km quantities.
* Not implemented: effective-layer SRH/shear, STP/SCP, ice-phase ascent.

## Engine test results
* 250 random physically-structured columns (inversions, moist/dry layers, LLJs, turning shear, elevated terrain): sign/ordering/finiteness, Galilean + rotation invariance of wind diagnostics, hemisphere mirror symmetry, level-doubling invariance, grid convergence (dp 1 vs 0.25 hPa), monotonicity, degenerate-input fuzzing.
* Independent re-derivation (height-space integral, DOP853 ODE solver, brute-force layer scan) agrees with the engine: worst CAPE difference 0.01 %, worst CIN 0.3 % over 60 columns. Moist-adiabat integrator vs SciPy: < 1e-4 K.
* **Bugs found and fixed:** (1) a thin positive-buoyancy sliver just above the LCL could hide a deep layer above a cap (CAPE 3843 → 0.004 J/kg, cap invisible) — now the principal layer is used; (2) θe formula mixed two Bolton equations (broke MU-parcel selection); (3) wet-bulb zero depended on input resolution.
* Grid design check: columns pushed through the 57-level internal grid reproduce SBCAPE with r = 1.0000 (MAE 20 J/kg for CAPE > 1500 J/kg), shear MAE 0.43 m/s.
* **Not tested:** real soundings (none available offline) — use `scripts/compare_sounding.py` against SHARPpy/MetPy. Expect a few % differences from Tv correction and LFC/EL conventions.

## Neural network (skywatch/nn)
Spatial CNN on gridded teacher history + separate geography encoder → temporal transformer → K latent state tokens →
Perceiver-style cross-attention over observation tokens (learned null token ⇒ no NaNs when there are no observations) →
level-query decoder (ln p, height above ground, teacher prior) with dilated vertical convolutions → heteroscedastic Gaussian
heads for T, ln q, u, v, Z on the 57-level grid + surface head. Mean is a **residual on the teacher prior** with zero-initialised
heads (untrained model == baseline B). q > 0 by construction (ln q). Below-ground levels are filled (inputs) and masked (losses).
Losses: CRPS/MAE blend teacher loss, observation loss with observation-uncertainty-inflated spread, gradient (structure) loss,
physics (hydrostatic, supersaturation, superadiabatic — soft), calibration; staged by `LossSchedule` (teacher → obs → structure
→ physics → probabilistic → event fine-tune). Trainer: AdamW, warmup+cosine, EMA, NaN guard, checkpoints record dataset version.
V1 uncertainty = per-level Gaussian + vertically-correlated sampling (`ensemble.sample_normalized`); coherent latent sampling is V5.

## Data contract (what the real ETL must emit)
See `skywatch/contract.py` and run `validate_sample` on every sample. Key rules: normalised transformed space; below-ground levels
filled with the lowest valid level; `obs_target` must be held out from input tokens; observation uncertainty > 0 wherever an
observation exists; `valid` = grid ≤ target surface pressure. Fit a real `Normalizer` with `Normalizer.fit` (the default is for smoke tests).

## Layout
    skywatch/  constants thermo profile diagnostics | grid normalizer obs_tokens contract synthetic | baselines ensemble evaluate lossmath io
    skywatch/nn/  model losses schedule data train
    scripts/   smoke_test.py compare_sounding.py      tests/  (unittest; pytest also works)
