#!/usr/bin/env python
"""Run the diagnostics engine on a real radiosonde CSV, to compare against SHARPpy / MetPy / SPC sounding analysis.

  python scripts/compare_sounding.py sonde.csv --wind-units kt --hemisphere S
  python scripts/compare_sounding.py sonde.csv --no-virtual        # closer to MetPy's default CAPE (no Tv correction)

CSV columns (case-insensitive, common aliases accepted): pressure [hPa], temperature [C], dewpoint [C],
wind direction [deg], wind speed [kt|ms|kmh|mph], optional height [m]. Expect a few % difference between tools:
virtual-temperature correction, LFC/EL conventions and interpolation all differ. Compare magnitude and ordering of
CAPE/CIN/LCL/LFC/EL and shear; big disagreements (>15%) on a good sounding are worth reporting.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from skywatch.io import read_sounding_csv
from skywatch import compute_diagnostics

ap = argparse.ArgumentParser()
ap.add_argument("csv"); ap.add_argument("--wind-units", default="kt"); ap.add_argument("--temp-units", default="C")
ap.add_argument("--hemisphere", default="S", choices=["N", "S"]); ap.add_argument("--no-virtual", action="store_true")
ap.add_argument("--json", action="store_true")
a = ap.parse_args()

prof, meta = read_sounding_csv(a.csv, wind_units=a.wind_units, temp_units=a.temp_units)
d = compute_diagnostics(prof, hemisphere=a.hemisphere, virtual=not a.no_virtual)
if a.json:
    print(json.dumps(dict(meta=meta, diagnostics=d), indent=1)); sys.exit(0)
print("sounding:", meta)
rows = [("SBCAPE J/kg", "SBCAPE"), ("SBCIN J/kg", "SBCIN"), ("MLCAPE J/kg", "MLCAPE"), ("MLCIN J/kg", "MLCIN"),
        ("MUCAPE J/kg", "MUCAPE"), ("MUCIN J/kg", "MUCIN"), ("SB LCL m AGL", "SB_LCL"), ("SB LFC m AGL", "SB_LFC"),
        ("SB EL m AGL", "SB_EL"), ("PWAT mm", "PWAT"), ("0-1 km shear m/s", "shear_0_1km"), ("0-3 km shear m/s", "shear_0_3km"),
        ("0-6 km shear m/s", "shear_0_6km"), (f"0-1 km SRH ({a.hemisphere}H conv.)", "srh_0_1km"), (f"0-3 km SRH ({a.hemisphere}H conv.)", "srh_0_3km"),
        ("storm motion u m/s", "storm_motion_u"), ("storm motion v m/s", "storm_motion_v"), ("0-3 km lapse K/km", "lapse_0_3km"),
        ("3-6 km lapse K/km", "lapse_3_6km"), ("700-500 lapse K/km", "lapse_700_500"), ("freezing level m AGL", "freezing_level"),
        ("wet-bulb zero m AGL", "wet_bulb_zero")]
for label, k in rows:
    print(f"  {label:28s} {d[k]:10.1f}")
