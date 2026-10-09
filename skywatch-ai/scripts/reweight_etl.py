#!/usr/bin/env python
"""Recompute event_weight in existing ETL .npz from decoded target profiles.

  python scripts/reweight_etl.py --data data/etl/au_v1
"""
from __future__ import annotations

import argparse
import glob
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from skywatch import compute_diagnostics
from skywatch.evaluate import inversion_strength
from skywatch.grid import make_vertical_grid
from skywatch.normalizer import Normalizer
from skywatch.profile import Profile

ap = argparse.ArgumentParser()
ap.add_argument("--data", default="data/etl/au_v1")
ap.add_argument("--cape-hi", type=float, default=2000.0)
ap.add_argument("--cape-mid", type=float, default=500.0)
ap.add_argument("--inv-k", type=float, default=1.5)
ap.add_argument("--hemisphere", default="S")
args = ap.parse_args()

grid = make_vertical_grid()
norm = Normalizer.default(grid)
files = sorted(glob.glob(os.path.join(args.data, "*.npz")))
print(f"reweighting {len(files)} files in {args.data}")

changed = hi = mid = inv = 0
for path in files:
    with np.load(path, allow_pickle=False) as z:
        data = {k: z[k] for k in z.files}
    old = float(data["event_weight"])
    try:
        native = norm.decode_profile(data["target_profile"])
        # native: T, lnq, u, v, Z — build Profile
        T = native[0]
        lnq = native[1]
        u, v, Z = native[2], native[3], native[4]
        q = np.exp(lnq)
        p_sfc = float(norm.decode_surface(data["target_surface"])[4])
        # Approximate pressure from Z via hydrostatic-ish grid: use model grid_p clipped by valid
        valid = data["valid"].astype(bool)
        p = np.asarray(grid, dtype=np.float64).copy()
        prof = Profile(p[valid], T[valid], q[valid], u[valid], v[valid], z=Z[valid])
        diag = compute_diagnostics(prof, hemisphere=args.hemisphere.upper())
        sbcape = float(diag.get("SBCAPE") or 0.0)
        w = 1.0
        if math.isfinite(sbcape):
            if sbcape > args.cape_hi:
                w *= 4.0
                hi += 1
            elif sbcape > args.cape_mid:
                w *= 2.0
                mid += 1
        strength, _ = inversion_strength(prof.T, prof.z_agl)
        if math.isfinite(strength) and strength >= args.inv_k:
            w *= 2.5
            inv += 1
    except Exception as exc:  # noqa: BLE001
        print(f"skip {os.path.basename(path)}: {exc}")
        continue
    if abs(w - old) > 1e-6:
        data["event_weight"] = np.float32(w)
        np.savez_compressed(path, **data)
        changed += 1

print(
    f"done: changed={changed}/{len(files)} "
    f"high_cape={hi} mid_cape={mid} inversion={inv}"
)
