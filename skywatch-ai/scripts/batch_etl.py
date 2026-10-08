#!/usr/bin/env python
"""Batch-build AU training samples: Open-Meteo teacher + UWYO radiosonde.

  python scripts/batch_etl.py --days 60 --out data/etl/au_v1
  python scripts/batch_etl.py --days 3 --stations 94610,94767,94866

Uses UWYO BUFR *inventory* times (AU launches are often 11Z/19Z/23Z, not 00/12).
Writes one .npz per success + manifest.jsonl. Skips failures (no sounding / API).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from skywatch.contract import validate_sample
from skywatch.etl.build_sample import build_training_sample
from skywatch.etl.openmeteo_teacher import fetch_teacher_column
from skywatch.etl.uwyo_obs import fetch_radiosonde, recent_slots
from skywatch.grid import make_vertical_grid
from skywatch.normalizer import Normalizer

# Core AU radiosonde sites (high availability + a few extras).
DEFAULT_STATIONS = [
    ("94120", -12.42, 130.89),  # Darwin
    ("94203", -17.95, 122.23),  # Broome
    ("94294", -16.88, 145.75),  # Cairns
    ("94312", -20.38, 118.63),  # Port Hedland
    ("94326", -23.80, 133.89),  # Alice Springs
    ("94332", -19.25, 146.77),  # Townsville
    ("94430", -28.80, 114.70),  # Geraldton
    ("94578", -27.39, 153.13),  # Brisbane
    ("94610", -31.93, 115.98),  # Perth
    ("94672", -34.95, 138.52),  # Adelaide
    ("94767", -33.95, 151.18),  # Sydney
    ("94866", -37.67, 144.84),  # Melbourne
    ("94970", -42.83, 147.50),  # Hobart
]


ap = argparse.ArgumentParser()
ap.add_argument("--days", type=int, default=60)
ap.add_argument("--stations", default=None, help="comma WMO ids")
ap.add_argument("--out", default="data/etl/au_v1")
ap.add_argument("--sleep", type=float, default=1.0, help="pause between API calls")
ap.add_argument("--seed", type=int, default=0)
ap.add_argument(
    "--max-per-station",
    type=int,
    default=24,
    help="cap inventory slots per station (most recent first)",
)
ap.add_argument(
    "--fresh",
    action="store_true",
    help="delete existing .npz + manifest before running",
)
args = ap.parse_args()

if args.stations:
    want = set(args.stations.split(","))
    stations = [s for s in DEFAULT_STATIONS if s[0] in want]
    # Allow ad-hoc WMO ids with lat/lon unknown → skip (must be in DEFAULT)
    missing = want - {s[0] for s in stations}
    if missing:
        print(f"warning: unknown stations ignored: {sorted(missing)}", file=sys.stderr)
else:
    stations = DEFAULT_STATIONS

os.makedirs(args.out, exist_ok=True)
if args.fresh:
    for name in os.listdir(args.out):
        if name.endswith(".npz") or name == "manifest.jsonl":
            os.remove(os.path.join(args.out, name))
    print(f"fresh: cleared {args.out}")

manifest_path = os.path.join(args.out, "manifest.jsonl")
# Fresh run: rewrite manifest (keep existing .npz via skip).
if os.path.isfile(manifest_path) and not any(
    f.endswith(".npz") for f in os.listdir(args.out)
):
    os.remove(manifest_path)

norm = Normalizer.default(make_vertical_grid())
rng = np.random.default_rng(args.seed)

ok = fail = 0
with open(manifest_path, "a") as mf:
    for wmo, lat, lon in stations:
        print(f"[{wmo}] inventory…", flush=True)
        try:
            slots = recent_slots(
                wmo, days=args.days, max_slots=args.max_per_station
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[{wmo}] inventory FAIL {exc}")
            fail += 1
            mf.write(
                json.dumps(
                    {
                        "ok": False,
                        "wmo": wmo,
                        "time": None,
                        "error": f"inventory: {exc}"[:240],
                    }
                )
                + "\n"
            )
            mf.flush()
            continue
        if not slots:
            print(f"[{wmo}] no inventory slots in last {args.days}d")
            continue
        print(f"[{wmo}] {len(slots)} slots", flush=True)
        time.sleep(args.sleep)

        for t in slots:
            iso = t.strftime("%Y-%m-%dT%H:%M:%SZ")
            tag = f"{wmo}_{t.strftime('%Y%m%d_%H%M')}Z"
            path = os.path.join(args.out, f"{tag}.npz")
            if os.path.isfile(path):
                print(f"skip existing {tag}")
                ok += 1
                continue
            try:
                print(f"[{tag}] sonde…", flush=True)
                sonde = fetch_radiosonde(wmo, time_iso=iso)
                time.sleep(args.sleep)
                print(f"[{tag}] teacher…", flush=True)
                teacher = fetch_teacher_column(
                    lat, lon, model="ifs", time_iso=iso, prefer_archive=True
                )
                time.sleep(args.sleep)
                sample = build_training_sample(
                    teacher,
                    sonde,
                    lat=lat,
                    lon=lon,
                    norm=norm,
                    rng=rng,
                )
                errs = validate_sample(sample, norm)
                if errs:
                    raise ValueError("; ".join(errs[:5]))
                np.savez_compressed(path, **sample)
                rec = {
                    "ok": True,
                    "path": path,
                    "wmo": wmo,
                    "lat": lat,
                    "lon": lon,
                    "time": iso,
                    "teacher": teacher.get("source"),
                    "sonde_levels": int(sonde["p"].size),
                    "event_weight": float(sample["event_weight"]),
                }
                mf.write(json.dumps(rec) + "\n")
                mf.flush()
                ok += 1
                print(f"[{tag}] OK ew={sample['event_weight']} → {path}")
            except Exception as exc:  # noqa: BLE001
                fail += 1
                rec = {
                    "ok": False,
                    "wmo": wmo,
                    "time": iso,
                    "error": str(exc)[:240],
                }
                mf.write(json.dumps(rec) + "\n")
                mf.flush()
                print(f"[{tag}] FAIL {exc}")
                time.sleep(args.sleep)

print(f"\ndone: ok={ok} fail={fail} out={args.out}")
sys.exit(0 if ok > 0 else 1)
