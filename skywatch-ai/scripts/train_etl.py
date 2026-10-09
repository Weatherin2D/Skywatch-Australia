#!/usr/bin/env python
"""Train V1 on ETL .npz samples (optionally mixed with synthetic).

  python scripts/train_etl.py --data data/etl/au_v1 --steps 1500 --out runs/etl-v1
  python scripts/train_etl.py --data data/etl/au_v1 --synthetic 1500 --steps 2500 --promote

Promotes best EMA checkpoint to checkpoints/v1-etl.pt when --promote.
Prefer real samples in validation via --real-val-frac / --holdout-stations.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import torch

from skywatch.evaluate import check_targets
from skywatch.grid import make_vertical_grid
from skywatch.normalizer import Normalizer
from skywatch.nn.model import ModelConfig
from skywatch.nn.schedule import ScheduleConfig
from skywatch.nn.train import (
    TrainConfig,
    format_table,
    load_checkpoint,
    run_evaluation,
    train,
)
from skywatch.synthetic import N_FIELD_CHANNELS, N_HIST, N_STATIC, make_dataset


def load_npz_dir(path: str):
    files = sorted(glob.glob(os.path.join(path, "*.npz")))
    samples, metas = [], []
    for f in files:
        with np.load(f, allow_pickle=False) as z:
            samples.append({k: z[k] for k in z.files})
        base = os.path.basename(f)
        m = re.match(r"^(\d{5})_", base)
        metas.append({"path": f, "wmo": m.group(1) if m else "unknown"})
    return samples, files, metas


def split_real_val(real, metas, *, holdout_stations, real_val_frac, seed):
    rng = np.random.default_rng(seed)
    n = len(real)
    if n == 0:
        return [], []
    if holdout_stations:
        want = set(holdout_stations)
        val_i = [i for i, m in enumerate(metas) if m["wmo"] in want]
        train_i = [i for i in range(n) if i not in set(val_i)]
        if val_i:
            return [real[i] for i in train_i], [real[i] for i in val_i]
    order = sorted(range(n), key=lambda i: metas[i]["path"])
    n_val = max(1, int(round(n * real_val_frac)))
    val_i = order[-n_val:]
    train_i = order[:-n_val] if n_val < n else order
    rng.shuffle(train_i)
    return [real[i] for i in train_i], [real[i] for i in val_i]


ap = argparse.ArgumentParser()
ap.add_argument("--data", default="data/etl/au_v1")
ap.add_argument("--synthetic", type=int, default=400, help="extra synthetic samples")
ap.add_argument("--steps", type=int, default=1500)
ap.add_argument("--batch-size", type=int, default=16)
ap.add_argument("--d-model", type=int, default=96)
ap.add_argument("--lr", type=float, default=3e-4)
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--out", default="runs/etl-v1")
ap.add_argument("--promote", action="store_true")
ap.add_argument(
    "--val-frac",
    type=float,
    default=0.2,
    help="fraction of *synthetic* pool used for val (real val via --real-val-frac)",
)
ap.add_argument(
    "--real-val-frac",
    type=float,
    default=0.2,
    help="fraction of real ETL samples held out for validation (chronological)",
)
ap.add_argument(
    "--holdout-stations",
    default="",
    help="comma WMO ids forced into real validation (overrides frac for those)",
)
ap.add_argument(
    "--event-boundary",
    type=float,
    default=0.90,
    help="fraction of steps when event_finetune stage starts (default 0.90)",
)
ap.add_argument(
    "--event-lr-mult",
    type=float,
    default=0.3,
    help="LR multiplier during event_finetune",
)
args = ap.parse_args()

real, files, metas = load_npz_dir(args.data)
print(f"loaded {len(real)} ETL samples from {args.data} ({len(files)} files)")

grid = make_vertical_grid()
# Samples from batch_etl / build_sample are already encoded with Normalizer.default.
norm = Normalizer.default(grid)
print("using default Normalizer (matches ETL encoding)")

holdout = [s for s in args.holdout_stations.split(",") if s.strip()]
real_train, real_val = split_real_val(
    real,
    metas,
    holdout_stations=holdout,
    real_val_frac=args.real_val_frac,
    seed=args.seed,
)
print(
    f"real split train={len(real_train)} val={len(real_val)} "
    f"holdout_stations={holdout or 'chronological'}"
)

synth = []
if args.synthetic > 0:
    print(f"generating {args.synthetic} synthetic samples…")
    synth = make_dataset(args.synthetic, seed=args.seed + 7, grid_p=grid, norm=norm)

rng = np.random.default_rng(args.seed)
if synth:
    sidx = rng.permutation(len(synth))
    n_sval = max(1, int(len(synth) * args.val_frac))
    synth_val = [synth[i] for i in sidx[:n_sval]]
    synth_train = [synth[i] for i in sidx[n_sval:]]
else:
    synth_train, synth_val = [], []

train_s = real_train + synth_train
val_s = real_val + synth_val
if len(train_s) < args.batch_size:
    print(
        f"need ≥ {args.batch_size} samples, have {len(train_s)}; bump --synthetic",
        file=sys.stderr,
    )
    sys.exit(2)
if not val_s:
    val_s = train_s[: max(1, len(train_s) // 5)]

print(
    f"train={len(train_s)} val={len(val_s)} "
    f"(real={len(real)} synth={len(synth)}; real_val={len(real_val)})"
)

d = args.d_model
cfg = ModelConfig(
    grid_p=tuple(float(p) for p in grid),
    n_field_channels=N_FIELD_CHANNELS,
    n_static_channels=N_STATIC,
    n_history=N_HIST,
    d_model=d,
    n_latent=4 if d <= 64 else 8,
    n_heads=4,
    n_obs_layers=1 if d <= 64 else 2,
    n_dec_layers=1 if d <= 64 else 2,
    enc_channels=(32, 48, 64) if d <= 64 else (64, 96, 128),
)
tcfg = TrainConfig(
    steps=args.steps,
    batch_size=args.batch_size,
    lr=args.lr,
    warmup=min(100, args.steps // 5),
    eval_every=max(args.steps // 5, 1),
    log_every=max(args.steps // 20, 1),
    ema_decay=0.995,
    seed=args.seed,
    out_dir=args.out,
    dataset_version=f"etl+synth-{len(real)}r-{len(synth)}s",
)
os.makedirs(args.out, exist_ok=True)
# Keep previous promoted weights if we need to roll back after holdout.
prev = os.path.join("checkpoints", "v1-etl.pt")
prev_bak = os.path.join("checkpoints", "v1-etl-prev.pt")
if args.promote and os.path.isfile(prev):
    shutil.copy2(prev, prev_bak)
    print("backed up previous →", prev_bak)

# Earlier event_finetune spends more steps on CAPE/inversion-weighted samples.
bounds = list(ScheduleConfig().boundaries)
# boundaries: teacher, obs, structure, physics, probabilistic, event
# Keep first five; set last (event start) from --event-boundary.
if len(bounds) >= 6:
    bounds[5] = float(np.clip(args.event_boundary, 0.5, 0.95))
scfg = ScheduleConfig(
    total_steps=args.steps,
    boundaries=tuple(bounds),
    event_lr_mult=args.event_lr_mult,
)
print(
    f"schedule event_boundary={bounds[5]:.2f} event_lr_mult={args.event_lr_mult}"
)
model, hist = train(cfg, tcfg, scfg, train_s, val_s, norm)

print("\nEngine evaluation on validation set:")
res = run_evaluation(model, train_s, val_s, norm, "cpu", hemisphere="S")
print(format_table(res))
for k, v in check_targets(res["V1_model"]).items():
    print(f"  {k:24s} {v['value']:8.3f} {v['op']} {v['target']:<6} {'ok' if v['passed'] else '--'}")

metrics_path = os.path.join(args.out, "metrics.json")
with open(metrics_path, "w") as f:
    json.dump(
        {
            k: {
                kk: float(vv) if np.isfinite(vv) else None
                for kk, vv in m.items()
            }
            for k, m in res.items()
        },
        f,
        indent=2,
    )
print("wrote", metrics_path)

ck = os.path.join(args.out, "ckpt.pt")
if args.promote and os.path.isfile(ck):
    dest = os.path.join("checkpoints", "v1-etl.pt")
    os.makedirs("checkpoints", exist_ok=True)
    shutil.copy2(ck, dest)
    print("promoted →", dest)
    load_checkpoint(dest, "cpu")
    print("checkpoint load OK")
