#!/usr/bin/env python
"""Evaluate a checkpoint on held-out *real* AU ETL samples.

  python scripts/eval_holdout.py --data data/etl/au_v1 --ckpt checkpoints/v1-etl.pt
  python scripts/eval_holdout.py --holdout-stations 94767,94610 --real-val-frac 0.2

Writes runs/holdout-metrics.json (or --out).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from skywatch.evaluate import check_targets
from skywatch.grid import make_vertical_grid
from skywatch.normalizer import Normalizer
from skywatch.nn.train import format_table, load_checkpoint, run_evaluation


def load_npz_dir(path: str):
    files = sorted(glob.glob(os.path.join(path, "*.npz")))
    samples, metas = [], []
    for f in files:
        with np.load(f, allow_pickle=False) as z:
            samples.append({k: z[k] for k in z.files})
        base = os.path.basename(f)
        m = re.match(r"^(\d{5})_", base)
        metas.append({"path": f, "wmo": m.group(1) if m else "unknown"})
    return samples, metas


def split_holdout(samples, metas, *, holdout_stations, real_val_frac, seed):
    """Prefer station holdout; else last real_val_frac by sorted filename time."""
    rng = np.random.default_rng(seed)
    n = len(samples)
    if n == 0:
        return [], [], [], []

    if holdout_stations:
        want = set(holdout_stations)
        val_i = [i for i, m in enumerate(metas) if m["wmo"] in want]
        train_i = [i for i in range(n) if i not in set(val_i)]
        if not val_i:
            print(
                f"warning: no samples for holdout stations {sorted(want)}; "
                f"falling back to frac split",
                file=sys.stderr,
            )
        else:
            return (
                [samples[i] for i in train_i],
                [samples[i] for i in val_i],
                [metas[i] for i in train_i],
                [metas[i] for i in val_i],
            )

    order = np.arange(n)
    # Chronological by filename (WMO_YYYYMMDD_HHMMZ.npz)
    order = sorted(order, key=lambda i: metas[i]["path"])
    n_val = max(1, int(round(n * real_val_frac)))
    val_i = order[-n_val:]
    train_i = order[:-n_val] if n_val < n else order[: max(1, n // 5)]
    # Light shuffle within splits for ridge fit diversity
    rng.shuffle(train_i)
    return (
        [samples[i] for i in train_i],
        [samples[i] for i in val_i],
        [metas[i] for i in train_i],
        [metas[i] for i in val_i],
    )


ap = argparse.ArgumentParser()
ap.add_argument("--data", default="data/etl/au_v1")
ap.add_argument("--ckpt", default="checkpoints/v1-etl.pt")
ap.add_argument("--holdout-stations", default="", help="comma WMO ids")
ap.add_argument("--real-val-frac", type=float, default=0.2)
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--out", default="metrics/holdout-metrics.json")
ap.add_argument("--hemisphere", default="S")
args = ap.parse_args()

samples, metas = load_npz_dir(args.data)
print(f"loaded {len(samples)} real samples from {args.data}")
if not samples:
    print("no samples", file=sys.stderr)
    sys.exit(2)

holdout = [s for s in args.holdout_stations.split(",") if s.strip()]
train_s, val_s, train_m, val_m = split_holdout(
    samples,
    metas,
    holdout_stations=holdout,
    real_val_frac=args.real_val_frac,
    seed=args.seed,
)
print(
    f"holdout train={len(train_s)} val={len(val_s)} "
    f"val_stations={sorted({m['wmo'] for m in val_m})}"
)

if not os.path.isfile(args.ckpt):
    print(f"checkpoint missing: {args.ckpt}", file=sys.stderr)
    sys.exit(2)

model, norm, ck = load_checkpoint(args.ckpt, "cpu", use_ema=True)
# Prefer checkpoint normalizer; fall back to default if shapes mismatch.
try:
    _ = norm.grid_p
except Exception:  # noqa: BLE001
    norm = Normalizer.default(make_vertical_grid())

# Ridge baseline needs a train set; if empty, reuse val.
fit_s = train_s if train_s else val_s
res = run_evaluation(model, fit_s, val_s, norm, "cpu", hemisphere=args.hemisphere)
print(format_table(res))
gates = check_targets(res["V1_model"])
for k, v in gates.items():
    print(
        f"  {k:24s} {v['value']:8.3f} {v['op']} {v['target']:<6} "
        f"{'ok' if v['passed'] else '--'}"
    )

payload = {
    "checkpoint": args.ckpt,
    "dataset_version": ck.get("train_cfg", {}).get("dataset_version")
    if isinstance(ck.get("train_cfg"), dict)
    else ck.get("dataset_version"),
    "n_real": len(samples),
    "n_train": len(train_s),
    "n_val": len(val_s),
    "val_stations": sorted({m["wmo"] for m in val_m}),
    "holdout_stations": holdout,
    "real_val_frac": args.real_val_frac,
    "metrics": {
        k: {
            kk: (float(vv) if np.isfinite(vv) else None)
            for kk, vv in m.items()
        }
        for k, m in res.items()
    },
    "gates": {
        k: {
            "value": float(v["value"]) if np.isfinite(v["value"]) else None,
            "op": v["op"],
            "target": v["target"],
            "passed": bool(v["passed"]),
        }
        for k, v in gates.items()
    },
}
os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
with open(args.out, "w") as f:
    json.dump(payload, f, indent=2)
print("wrote", args.out)
