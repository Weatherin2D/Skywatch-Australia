#!/usr/bin/env python
"""Train V1 on ETL .npz samples (optionally mixed with synthetic).

  python scripts/train_etl.py --data data/etl/au_v1 --steps 1500 --out runs/etl-v1
  python scripts/train_etl.py --data data/etl/au_v1 --synthetic 800 --steps 2000

Promotes best EMA checkpoint to checkpoints/v1-etl.pt when --promote.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
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
    samples = []
    for f in files:
        with np.load(f, allow_pickle=False) as z:
            samples.append({k: z[k] for k in z.files})
    return samples, files


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
ap.add_argument("--val-frac", type=float, default=0.2)
args = ap.parse_args()

real, files = load_npz_dir(args.data)
print(f"loaded {len(real)} ETL samples from {args.data} ({len(files)} files)")

grid = make_vertical_grid()
# Samples from batch_etl / build_sample are already encoded with Normalizer.default.
# Fitting on those tensors would treat z-scores as physical units and blow up physics.
norm = Normalizer.default(grid)
print("using default Normalizer (matches ETL encoding)")

synth = []
if args.synthetic > 0:
    print(f"generating {args.synthetic} synthetic samples…")
    synth = make_dataset(args.synthetic, seed=args.seed + 7, grid_p=grid, norm=norm)

all_s = real + synth
if len(all_s) < args.batch_size:
    print(
        f"need ≥ {args.batch_size} samples, have {len(all_s)}; bump --synthetic",
        file=sys.stderr,
    )
    sys.exit(2)

rng = np.random.default_rng(args.seed)
idx = rng.permutation(len(all_s))
n_val = max(1, int(len(all_s) * args.val_frac))
val_i, train_i = idx[:n_val], idx[n_val:]
if len(train_i) < args.batch_size:
    # Keep enough for a batch
    train_i = idx
    val_i = idx[: max(1, len(idx) // 5)]
train_s = [all_s[i] for i in train_i]
val_s = [all_s[i] for i in val_i]
print(f"train={len(train_s)} val={len(val_s)} (real={len(real)} synth={len(synth)})")

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
model, hist = train(cfg, tcfg, ScheduleConfig(), train_s, val_s, norm)

print("\nEngine evaluation on validation set:")
res = run_evaluation(model, train_s, val_s, norm, "cpu", hemisphere="S")
print(format_table(res))
for k, v in check_targets(res["V1_model"]).items():
    print(f"  {k:24s} {v['value']:8.3f} {v['op']} {v['target']:<6} {'ok' if v['passed'] else '--'}")

metrics_path = os.path.join(args.out, "metrics.json")
with open(metrics_path, "w") as f:
    json.dump({k: {kk: float(vv) if np.isfinite(vv) else None for kk, vv in m.items()} for k, m in res.items()}, f, indent=2)
print("wrote", metrics_path)

ck = os.path.join(args.out, "ckpt.pt")
if args.promote and os.path.isfile(ck):
    dest = os.path.join("checkpoints", "v1-etl.pt")
    os.makedirs("checkpoints", exist_ok=True)
    shutil.copy2(ck, dest)
    print("promoted →", dest)
    # sanity load
    load_checkpoint(dest, "cpu")
    print("checkpoint load OK")
