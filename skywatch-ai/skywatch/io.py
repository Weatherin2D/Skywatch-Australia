"""Read a real radiosonde ascent from CSV into an engine Profile (for checking against SHARPpy/MetPy/etc.)."""
from __future__ import annotations
from typing import Dict, Tuple
import numpy as np
import pandas as pd
from .constants import EPS
from .profile import Profile
from . import thermo as th

_ALIASES = {
    "p": ("pressure", "pres", "p", "pressure_hpa", "press", "pressure_mb", "pres_hpa"),
    "z": ("height", "hght", "z", "height_m", "hght_m", "alt", "altitude", "geopotential_height"),
    "T": ("temperature", "temp", "t", "temp_c", "tempc", "temperature_c", "tdry"),
    "Td": ("dewpoint", "dwpt", "td", "dewpoint_c", "dewp", "dew_point", "dwpt_c"),
    "dir": ("wdir", "drct", "direction", "wind_dir", "winddir", "wind_direction"),
    "spd": ("wspd", "sknt", "speed", "wind_speed", "windspd", "sped", "wspd_kt"),
}
_SPEED = {"kt": 0.514444, "ms": 1.0, "kmh": 1 / 3.6, "mph": 0.44704}


def _find(df, key, required=True):
    cols = {c.strip().lower(): c for c in df.columns}
    for a in _ALIASES[key]:
        if a in cols:
            return cols[a]
    if required:
        raise KeyError(f"no column for '{key}' (looked for {_ALIASES[key]}); columns are {list(df.columns)}")
    return None


def read_sounding_csv(path, *, wind_units: str = "kt", temp_units: str = "C") -> Tuple[Profile, Dict]:
    """Columns (case-insensitive): pressure [hPa], temperature, dewpoint, wind direction [deg from], wind speed,
    optional height [m]. Returns (Profile, meta). Rows with missing p/T/Td are dropped; missing winds are filled
    by interpolation in ln p; everything dropped/filled is counted in meta (nothing is silent)."""
    df = pd.read_csv(path)
    c = {k: _find(df, k, required=(k != "z")) for k in _ALIASES}
    n0 = len(df)
    d = pd.DataFrame({k: pd.to_numeric(df[c[k]], errors="coerce") if c[k] else np.nan for k in _ALIASES})
    d = d.dropna(subset=["p", "T", "Td"])
    d = d[(d.p > 50) & (d.p <= 1100)].sort_values("p", ascending=False).drop_duplicates("p")
    Tk = d["T"].to_numpy() + (273.15 if temp_units.upper() == "C" else 0.0)
    Tdk = d["Td"].to_numpy() + (273.15 if temp_units.upper() == "C" else 0.0)
    p = d["p"].to_numpy()
    e = th.sat_vapor_pressure(np.minimum(Tdk, Tk))
    w = EPS * e / (p - e)
    q = w / (1 + w)
    spd = d["spd"].to_numpy() * _SPEED[wind_units.lower()]
    ang = np.radians(d["dir"].to_numpy())
    u, v = -spd * np.sin(ang), -spd * np.cos(ang)
    bad = ~(np.isfinite(u) & np.isfinite(v))
    if bad.all():
        raise ValueError("no usable wind data")
    x = -np.log(p)
    if bad.any():
        u[bad] = np.interp(x[bad], x[~bad], u[~bad]); v[bad] = np.interp(x[bad], x[~bad], v[~bad])
    z = d["z"].to_numpy() if c["z"] else None
    z_used = z is not None and np.all(np.isfinite(z)) and np.all(np.diff(z) > 0)
    prof = Profile(p, Tk, q, u, v, z=z if z_used else None)
    meta = dict(rows_in=n0, rows_used=len(p), rows_dropped=n0 - len(p), winds_interpolated=int(bad.sum()),
                heights="provided" if z_used else "hydrostatic", surface_p=float(p[0]), top_p=float(p[-1]),
                top_height_agl_m=float(prof.z_agl[-1]))
    return prof, meta
