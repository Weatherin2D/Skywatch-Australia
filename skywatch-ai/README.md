# SkyWatch AI — V1 sounding model

Implements `01_ARCHITECTURE`, `02_DATA_PIPELINE`, `03_V1_SOUNDING_MODEL`.
Contract: **neural net → atmospheric state · deterministic engine → diagnostics · evaluation through the engine.**

## Site integration (this slice)

The **deterministic diagnostics engine** is served to SkyWatch `/soundings` via a FastAPI sidecar:

```bash
# From repo root
docker compose up -d skywatch-ai
# or locally:
pip install -r requirements.txt
uvicorn serve:app --host 0.0.0.0 --port 43137
```

- `GET /health`
- `POST /v1/diagnostics` — JSON levels → CAPE/CIN/LCL/SRH/…
- Next.js reads `SKYWATCH_AI_URL` (Compose sets `http://skywatch-ai:43137`). On Vercel Hobby leave it unset → legacy TypeScript thermo.
- Neural training is **not** in the runtime path (`requirements.txt` has no torch; use `requirements-train.txt` later).

## What is verified and what is not

| Component | Milestone | Status |
|---|---|---|
| Engine wired to SkyWatch `/soundings` via sidecar | site | **Done** (fallback to legacy when sidecar offline) |
| Deterministic diagnostics engine (`skywatch/diagnostics.py`, `thermo.py`) | 7 | **Tested** — 38 tests incl. randomised stress tests and an independent height-space re-derivation |
| Vertical grid, normaliser, observation tokens, data contract (`grid`, `normalizer`, `obs_tokens`, `contract`) | 1–2 | **Tested** (numpy) |
| Baselines A–D, evaluation metrics, coherent ensemble sampling, engine bridge | 3, 5 | **Tested** (numpy) |
| Loss mathematics (CRPS, gradient, hydrostatic, supersaturation, superadiabatic) — numpy reference | 6 | **Tested** (CRPS vs numerical integration; proper-scoring property; physics terms) |
| Loss schedule | 6 | **Tested** |
| PyTorch network, torch losses, trainer (`skywatch/nn/`) | 4–6 | **Written, syntax- and API-checked, NEVER EXECUTED** (authoring environment had no torch) |
| Real-data ETL (BARRA2 / ERA5 / radiosondes → samples) | 1 | **Not written** — needs your data layout; target format is `skywatch/contract.py` |
| Training on real data, skill claims | 8–9 | **Not done** |

## First things to run
    pip install -r requirements.txt
    python -m unittest discover -s tests -v          # 62 tests; 4 torch tests skip without torch
    python scripts/smoke_test.py                     # FIRST execution of the torch code (1-3 min on CPU)
    python scripts/smoke_test.py --steps 3000 --n-train 3000 --d-model 128 --strict   # real learning check on synthetic data
    python scripts/compare_sounding.py sonde.csv --hemisphere S                       # engine on a REAL radiosonde

If `smoke_test.py` fails, send me the traceback — the torch code is untested and small fixes are expected.
Synthetic data validates plumbing and learnability only; it says nothing about skill on real weather.

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
