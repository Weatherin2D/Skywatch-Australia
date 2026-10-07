"""Fetch Open-Meteo pressure-level columns as a V1 *teacher prior*.

Uses the free forecast API (best_match / ecmwf_ifs025 / bom_access_global_ensemble
when available). Not a reanalysis — good enough to bootstrap ETL until BARRA2/ERA5
archives are wired.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json
import math

import numpy as np

# Open-Meteo pressure levels commonly available (hPa)
OM_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100]

MODEL_MAP = {
    "pulse": "best_match",
    "ifs": "ecmwf_ifs025",
    "access": "bom_access_global",
    "gfs": "gfs_seamless",
}


def _get_json(url: str, timeout: float = 90.0) -> dict:
    req = Request(url, headers={"User-Agent": "SkyWatchAI-ETL/0.2"})
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def fetch_teacher_column(
    lat: float,
    lon: float,
    *,
    model: str = "pulse",
    time_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """Return native arrays p,T,q,u,v,z plus meta for one column.

    Temperatures Kelvin, q kg/kg, winds m/s, z geopotential m.
    """
    m = MODEL_MAP.get(model, model)
    vars_ = []
    for p in OM_LEVELS:
        vars_.extend(
            [
                f"temperature_{p}hPa",
                f"relative_humidity_{p}hPa",
                f"wind_u_component_{p}hPa",
                f"wind_v_component_{p}hPa",
                f"geopotential_height_{p}hPa",
            ]
        )
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "hourly": ",".join(vars_),
        "models": m,
        "timezone": "UTC",
        "forecast_days": "2",
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urlencode(params)
    data = _get_json(url)
    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        raise RuntimeError("Open-Meteo returned no hourly data")

    if time_iso:
        target = time_iso.replace("Z", "")[:16]
        try:
            idx = next(i for i, t in enumerate(times) if t[:16] == target[:16])
        except StopIteration:
            # nearest
            idx = min(
                range(len(times)),
                key=lambda i: abs(
                    datetime.fromisoformat(times[i]).replace(tzinfo=timezone.utc).timestamp()
                    - datetime.fromisoformat(target).replace(tzinfo=timezone.utc).timestamp()
                ),
            )
    else:
        idx = 0

    from skywatch import thermo as th
    from skywatch.constants import EPS

    p_list: List[float] = []
    T_list: List[float] = []
    q_list: List[float] = []
    u_list: List[float] = []
    v_list: List[float] = []
    z_list: List[float] = []
    for p in OM_LEVELS:
        tC = hourly.get(f"temperature_{p}hPa", [None])[idx]
        rh = hourly.get(f"relative_humidity_{p}hPa", [None])[idx]
        u = hourly.get(f"wind_u_component_{p}hPa", [None])[idx]
        v = hourly.get(f"wind_v_component_{p}hPa", [None])[idx]
        z = hourly.get(f"geopotential_height_{p}hPa", [None])[idx]
        if any(x is None or (isinstance(x, float) and math.isnan(x)) for x in (tC, rh, u, v, z)):
            continue
        Tk = float(tC) + 273.15
        es = float(th.sat_vapor_pressure(np.array([Tk]))[0])
        e = max(0.0, min(0.95 * p, (float(rh) / 100.0) * es))
        w = EPS * e / max(p - e, 1e-6)
        q = w / (1.0 + w)
        p_list.append(float(p))
        T_list.append(Tk)
        q_list.append(float(q))
        u_list.append(float(u))
        v_list.append(float(v))
        z_list.append(float(z))

    if len(p_list) < 5:
        raise RuntimeError("Open-Meteo column too short after NaN filter")

    # surface → top
    order = np.argsort(-np.asarray(p_list))
    return {
        "p": np.asarray(p_list, float)[order],
        "T": np.asarray(T_list, float)[order],
        "q": np.asarray(q_list, float)[order],
        "u": np.asarray(u_list, float)[order],
        "v": np.asarray(v_list, float)[order],
        "z": np.asarray(z_list, float)[order],
        "p_sfc": float(np.asarray(p_list, float)[order][0]),
        "valid_time": times[idx],
        "model": m,
        "source": "open-meteo",
        "lat": lat,
        "lon": lon,
    }
