"""Fetch UWYO radiosonde via /wsgi/sounding (BUFR CSV). Legacy cgi-bin is retired."""
from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np

from skywatch import thermo as th
from skywatch.constants import EPS

_UWYO = "https://weather.uwyo.edu/wsgi/sounding"


def _get_text(url: str, timeout: float = 45.0) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": "SkyWatchAI-ETL/0.3 (+soundings)",
            "Accept": "text/html,text/plain,*/*",
        },
    )
    try:
        with urlopen(req, timeout=timeout) as res:
            return res.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:200].strip()
        raise RuntimeError(f"UWYO HTTP {exc.code}: {body or exc.reason}") from exc


def fetch_inventory(wmo: str, year: int) -> List[datetime]:
    """Return available BUFR sounding times (UTC) for a station/year."""
    params = {
        "datetime": f"{year}-06-15 00:00:00",
        "id": wmo,
        "type": "INVENTORY",
        "src": "BUFR",
    }
    html = _get_text(_UWYO + "?" + urlencode(params), timeout=50.0)
    re_dt = re.compile(
        r"datetime=(\d{4}-\d{2}-\d{2})[ +](\d{2}):(\d{2}):(\d{2})", re.I
    )
    seen = set()
    out: List[datetime] = []
    for m in re_dt.finditer(html):
        if int(m.group(1)[:4]) != year:
            continue
        raw = f"{m.group(1)}T{m.group(2)}:{m.group(3)}:{m.group(4)}+00:00"
        try:
            t = datetime.fromisoformat(raw)
        except ValueError:
            continue
        key = t.isoformat()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    out.sort(reverse=True)
    return out


def recent_slots(
    wmo: str,
    *,
    days: int = 5,
    max_slots: Optional[int] = None,
) -> List[datetime]:
    """Inventory-backed launch times within the last `days` (UTC)."""
    now = datetime.now(timezone.utc)
    cutoff_dt = now.timestamp() - days * 86400
    # Include every calendar year the window touches (60d near Jan → prior year).
    years = {now.year, (now - timedelta(days=max(days, 0))).year}
    slots: List[datetime] = []
    for y in sorted(years):
        try:
            slots.extend(fetch_inventory(wmo, y))
        except Exception:  # noqa: BLE001 — empty year / network
            continue
    slots = [t for t in slots if t.timestamp() >= cutoff_dt and t <= now]
    slots.sort(reverse=True)
    if max_slots is not None:
        slots = slots[:max_slots]
    return slots


def _extract_csv(html: str) -> str:
    marker = "time,longitude,latitude,pressure"
    idx = html.lower().find(marker)
    if idx < 0:
        # sometimes without lowercase match on first line only
        idx = html.find("time,longitude,latitude,pressure")
    if idx < 0:
        raise RuntimeError("UWYO response missing CSV block")
    chunk = html[idx:]
    m = re.search(r"\n\s*</|\n<script|\n<div", chunk, flags=re.I)
    return (chunk[: m.start()] if m else chunk).strip()


def _parse_csv(csv: str) -> Dict[str, Any]:
    lines = [ln.strip() for ln in csv.splitlines() if ln.strip()]
    if len(lines) < 2:
        raise RuntimeError("UWYO CSV too short")
    cols = [c.strip().lower() for c in lines[0].split(",")]

    def find(*preds):
        for i, c in enumerate(cols):
            if all(p in c for p in preds):
                return i
        return -1

    iP = next((i for i, c in enumerate(cols) if c.startswith("pressure")), -1)
    iZ = find("geopotential")
    iT = next((i for i, c in enumerate(cols) if c.startswith("temperature")), -1)
    iTd = find("dew")
    iDir = find("wind", "direction")
    iSpd = find("wind", "speed")
    iLat = next((i for i, c in enumerate(cols) if c == "latitude"), -1)
    iLon = next((i for i, c in enumerate(cols) if c == "longitude"), -1)
    iTime = next((i for i, c in enumerate(cols) if c == "time"), -1)
    if iP < 0 or iT < 0 or iTd < 0:
        raise RuntimeError(f"UWYO CSV missing columns: {cols[:12]}")

    rows = []
    lat = lon = float("nan")
    valid_time = None
    for ln in lines[1:]:
        parts = ln.split(",")
        if len(parts) < 6:
            continue
        try:
            p = float(parts[iP])
            T = float(parts[iT])
            Td = float(parts[iTd])
        except ValueError:
            continue
        if not (math.isfinite(p) and math.isfinite(T) and math.isfinite(Td)):
            continue
        z = float(parts[iZ]) if iZ >= 0 else float("nan")
        wdir = float(parts[iDir]) if iDir >= 0 else float("nan")
        wspd = float(parts[iSpd]) if iSpd >= 0 else float("nan")
        if iLat >= 0:
            try:
                lat = float(parts[iLat])
            except ValueError:
                pass
        if iLon >= 0:
            try:
                lon = float(parts[iLon])
            except ValueError:
                pass
        if valid_time is None and iTime >= 0 and parts[iTime].strip():
            raw = parts[iTime].strip().replace(" ", "T")
            if not raw.endswith("Z"):
                raw = raw + "Z"
            valid_time = raw
        rows.append((p, z, T, Td, wdir, wspd))

    if len(rows) < 5:
        raise RuntimeError("UWYO sounding too short after parse")

    arr = np.asarray(rows, float)
    p, z, Tc, Tdc, wdir, wspd = (arr[:, i] for i in range(6))
    # Temps are °C in CSV
    T = Tc + 273.15
    Td = np.minimum(Tdc + 273.15, T)
    # Wind speed in CSV is m/s for BUFR path (SkyWatch TS treats as m/s)
    spd = wspd
    ang = np.radians(np.where(np.isfinite(wdir), wdir, 0.0))
    u = -spd * np.sin(ang)
    v = -spd * np.cos(ang)
    bad = ~(np.isfinite(u) & np.isfinite(v) & np.isfinite(wspd))
    if bad.any():
        x = -np.log(np.maximum(p, 1e-3))
        good = ~bad
        if good.any():
            u[bad] = np.interp(x[bad], x[good], u[good])
            v[bad] = np.interp(x[bad], x[good], v[good])
        else:
            u[:] = 0.0
            v[:] = 0.0

    order = np.argsort(-p)
    p, z, T, Td, u, v = p[order], z[order], T[order], Td[order], u[order], v[order]
    ok = np.isfinite(p) & np.isfinite(T) & np.isfinite(Td) & (p > 50) & (p <= 1100)
    p, z, T, Td, u, v = p[ok], z[ok], T[ok], Td[ok], u[ok], v[ok]
    _, uniq = np.unique(p, return_index=True)
    uniq = np.sort(uniq)
    p, z, T, Td, u, v = p[uniq], z[uniq], T[uniq], Td[uniq], u[uniq], v[uniq]

    e = th.sat_vapor_pressure(Td)
    w = EPS * e / np.maximum(p - e, 1e-6)
    q = w / (1.0 + w)

    if not (np.all(np.isfinite(z)) and np.all(np.diff(z) > 0)):
        from skywatch.profile import Profile

        z = Profile(p, T, q, u, v, z=None).z

    return {
        "p": p,
        "T": T,
        "q": q,
        "u": u,
        "v": v,
        "z": z,
        "p_sfc": float(p[0]),
        "lat": float(lat) if math.isfinite(lat) else None,
        "lon": float(lon) if math.isfinite(lon) else None,
        "valid_time": valid_time,
        "source": "uwyo-bufr",
    }


def fetch_radiosonde(
    wmo: str,
    *,
    time_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """Return p,T,q,u,v,z native arrays (surface→top) for a WMO radiosonde."""
    now = datetime.now(timezone.utc)
    if time_iso:
        t = datetime.fromisoformat(time_iso.replace("Z", "+00:00")).astimezone(
            timezone.utc
        )
    else:
        hour = 0 if now.hour < 12 else 12
        t = now.replace(hour=hour, minute=0, second=0, microsecond=0)

    dt = (
        f"{t.year:04d}-{t.month:02d}-{t.day:02d} "
        f"{t.hour:02d}:00:00"
    )
    params = {
        "datetime": dt,
        "id": wmo,
        "type": "TEXT:CSV",
        "src": "BUFR",
    }
    url = _UWYO + "?" + urlencode(params)
    text = _get_text(url)
    if "not found" in text.lower() and "<pre" not in text.lower() and "pressure" not in text.lower():
        raise RuntimeError(f"no sounding for {wmo} @ {dt}")
    csv = _extract_csv(text)
    out = _parse_csv(csv)
    out["wmo"] = wmo
    if not out.get("valid_time"):
        out["valid_time"] = t.strftime("%Y-%m-%dT%H:%M:%SZ")
    return out
