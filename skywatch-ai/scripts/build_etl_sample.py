#!/usr/bin/env python
"""Build one (or more) real-ish training samples: Open-Meteo teacher + UWYO sonde.

  python scripts/build_etl_sample.py --wmo 94610 --lat -31.95 --lon 115.86 --out data/etl/sample.npz
  python scripts/build_etl_sample.py --wmo 94767 --lat -33.95 --lon 151.18 --validate-only

Requires network. Samples pass skywatch.contract.validate_sample.
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from skywatch.contract import validate_sample
from skywatch.etl.build_sample import build_training_sample
from skywatch.etl.openmeteo_teacher import fetch_teacher_column
from skywatch.etl.uwyo_obs import fetch_radiosonde
from skywatch.grid import make_vertical_grid
from skywatch.normalizer import Normalizer

ap = argparse.ArgumentParser()
ap.add_argument("--wmo", default="94610")
ap.add_argument("--lat", type=float, default=-31.95)
ap.add_argument("--lon", type=float, default=115.86)
ap.add_argument("--model", default="pulse")
ap.add_argument("--time", default=None, help="ISO time for teacher/sonde")
ap.add_argument("--out", default=None)
ap.add_argument("--validate-only", action="store_true")
args = ap.parse_args()

print(f"fetch teacher Open-Meteo ({args.model}) @ {args.lat},{args.lon} …")
teacher = fetch_teacher_column(args.lat, args.lon, model=args.model, time_iso=args.time)
print(f"  teacher {teacher['valid_time']} levels={teacher['p'].size} model={teacher['model']}")

print(f"fetch UWYO radiosonde {args.wmo} …")
sonde = fetch_radiosonde(args.wmo, time_iso=args.time or teacher["valid_time"])
print(f"  sonde {sonde['valid_time']} levels={sonde['p'].size}")

norm = Normalizer.default(make_vertical_grid())
sample = build_training_sample(
    teacher, sonde, lat=args.lat, lon=args.lon, norm=norm, rng=np.random.default_rng(0)
)
errs = validate_sample(sample, norm)
print("contract:", "OK" if not errs else errs)
if errs:
    sys.exit(1)
if args.validate_only:
    sys.exit(0)
out = args.out or os.path.join("data", "etl", f"{args.wmo}_{sonde['valid_time'][:13].replace(':','')}.npz")
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
np.savez_compressed(out, **sample)
print("wrote", out)
