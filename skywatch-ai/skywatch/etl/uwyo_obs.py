"""Fetch UWYO radiosonde text into native arrays for observation tokens.

Uses the public University of Wyoming sounding text endpoint.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np

from skywatch import thermo as th
from skywatch.constants import EPS

_UWYO = "https://weather.uwyo.edu/cgi-bin/sounding"


def _get_text(url: str, timeout: float = 45.0) -> str:
    req = Request(url, headers={"User-Agent": "SkyWatchAI-ETL/0.2"})
    with urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8", errors="replace")


def _parse_uwyo_pre(text: str) -> np.ndarray:
    """Parse the fixed-width PRE block into rows [p,z,T,Td,dir,spd]."""
    m = re.search(r"<PRE>(.*?)</PRE>", text, flags=re.I | re.S)
    if not m:
        raise RuntimeError("UWYO response missing <PRE> block")
    body = m.group(1)
    rows = []
    for line in body.splitlines():
        # data lines start with pressure digits
        if not re.match(r"^\s*\d+\.\d+", line):
            continue
        parts = line.split()
        if len(parts) < 6:
            continue
        try:
            p, z, T, Td, wdir, wspd = (float(parts[i]) for i in range(6))
        except ValueError:
            continue
        rows.append((p, z, T, Td, wdir, wspd))
    if len(rows) < 5:
        raise RuntimeError("UWYO sounding too short")
    return np.asarray(rows, float)


def fetch_radiosonde(
    wmo: str,
    *,
    time_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """Return p,T,q,u,v,z native arrays (surface→top) for a WMO radiosonde."""
    now = datetime.now(timezone.utc)
    if time_iso:
        t = datetime.fromisoformat(time_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    else:
        # nearest 00/12Z
        hour = 0 if now.hour < 12 else 12
        t = now.replace(hour=hour, minute=0, second=0, microsecond=0)

    params = {
        "region": "naconf",
        "TYPE": "TEXT:LIST",
        "YEAR": f"{t.year:04d}",
        "MONTH": f"{t.month:02d}",
        "FROM": f"{t.day:02d}{t.hour:02d}",
        "TO": f"{t.day:02d}{t.hour:02d}",
        "STNM": wmo,
    }
    # Australia region works better with "ant" / "pac" for some stations — try naconf then samer
    text = None
    last_err = None
    for region in ("pac", "ant", "naconf", "samer"):
        params["region"] = region
        url = _UWYO + "?" + urlencode(params)
        try:
            text = _get_text(url)
            if "can't get" in text.lower() or "<PRE>" not in text:
                raise RuntimeError(f"no sounding for {wmo} @ {t.isoformat()}")
            break
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            text = None
    if text is None:
        raise RuntimeError(f"UWYO fetch failed: {last_err}")

    arr = _parse_uwyo_pre(text)
    p = arr[:, 0]
    z = arr[:, 1]
    T = arr[:, 2] + 273.15
    Td = arr[:, 3] + 273.15
    wdir = arr[:, 4]
    wspd_kt = arr[:, 5]
    spd = wspd_kt * 0.514444
    ang = np.radians(wdir)
    u = -spd * np.sin(ang)
    v = -spd * np.cos(ang)

    # sort surface→top, drop bad
    order = np.argsort(-p)
    p, z, T, Td, u, v = (a[order] for a in (p, z, T, Td, u, v))
    ok = np.isfinite(p) & np.isfinite(T) & np.isfinite(Td) & (p > 50) & (p <= 1100)
    p, z, T, Td, u, v = p[ok], z[ok], T[ok], Td[ok], u[ok], v[ok]
    Td = np.minimum(Td, T)
    e = th.sat_vapor_pressure(Td)
    w = EPS * e / np.maximum(p - e, 1e-6)
    q = w / (1.0 + w)

    # unique p
    _, uniq = np.unique(p, return_index=True)
    uniq = np.sort(uniq)
    p, z, T, q, u, v = p[uniq], z[uniq], T[uniq], q[uniq], u[uniq], v[uniq]

    return {
        "p": p,
        "T": T,
        "q": q,
        "u": u,
        "v": v,
        "z": z,
        "p_sfc": float(p[0]),
        "wmo": wmo,
        "valid_time": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "uwyo",
    }
