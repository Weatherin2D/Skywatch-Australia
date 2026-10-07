"""SkyWatch AI diagnostics sidecar — deterministic engine only (no torch).

  uvicorn serve:app --host 0.0.0.0 --port 43137

Endpoints:
  GET  /health
  POST /v1/diagnostics  — JSON profile → CAPE/SRH/… diagnostics
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from skywatch import Profile, compute_diagnostics
from skywatch import thermo as th
from skywatch.constants import EPS

app = FastAPI(title="SkyWatch AI", version="0.1.0", docs_url="/docs")


class LevelIn(BaseModel):
    """One sounding level. Temps in °C (or K if tempUnit=K). Winds optional."""

    p: float = Field(..., description="Pressure hPa")
    t: float = Field(..., description="Temperature")
    td: Optional[float] = Field(None, description="Dewpoint (same unit as t)")
    z: Optional[float] = Field(None, description="Geopotential height m AMSL")
    windDir: Optional[float] = Field(None, description="Wind direction ° from")
    windSpd: Optional[float] = Field(None, description="Wind speed (see windUnit)")
    u: Optional[float] = Field(None, description="u wind m/s (overrides dir/spd)")
    v: Optional[float] = Field(None, description="v wind m/s")


class DiagnosticsRequest(BaseModel):
    levels: List[LevelIn]
    hemisphere: str = "S"
    tempUnit: str = "C"  # C | K
    windUnit: str = "ms"  # ms | kt
    virtual: bool = True


class DiagnosticsResponse(BaseModel):
    engine: str = "skywatch-ai"
    hemisphere: str
    diagnostics: Dict[str, float]
    meta: Dict[str, Any]


_SPEED = {"kt": 0.514444, "ms": 1.0, "kmh": 1 / 3.6, "mph": 0.44704}


def _finite(x: Optional[float]) -> bool:
    return x is not None and math.isfinite(float(x))


def _profile_from_levels(
    levels: List[LevelIn],
    *,
    temp_unit: str,
    wind_unit: str,
) -> tuple[Profile, Dict[str, Any]]:
    if len(levels) < 3:
        raise HTTPException(400, "profile needs at least 3 levels")

    rows = sorted(levels, key=lambda L: L.p, reverse=True)
    p = np.array([L.p for L in rows], dtype=float)
    # Drop duplicate pressures (keep first = highest in sort = surface-ward)
    _, uniq = np.unique(p, return_index=True)
    uniq = np.sort(uniq)
    rows = [rows[i] for i in uniq]
    p = np.array([L.p for L in rows], dtype=float)

    t_off = 273.15 if temp_unit.upper() == "C" else 0.0
    T = np.array([L.t for L in rows], dtype=float) + t_off
    Td = np.array(
        [(L.td if _finite(L.td) else L.t) for L in rows],
        dtype=float,
    ) + t_off
    Td = np.minimum(Td, T)

    e = th.sat_vapor_pressure(Td)
    w = EPS * e / np.maximum(p - e, 1e-6)
    q = w / (1.0 + w)

    u = np.full(len(rows), np.nan)
    v = np.full(len(rows), np.nan)
    spd_scale = _SPEED.get(wind_unit.lower(), 1.0)
    for i, L in enumerate(rows):
        if _finite(L.u) and _finite(L.v):
            u[i], v[i] = float(L.u), float(L.v)
        elif _finite(L.windDir) and _finite(L.windSpd):
            ang = math.radians(float(L.windDir))
            spd = float(L.windSpd) * spd_scale
            u[i] = -spd * math.sin(ang)
            v[i] = -spd * math.cos(ang)

    bad = ~(np.isfinite(u) & np.isfinite(v))
    if bad.all():
        u[:] = 0.0
        v[:] = 0.0
        winds_interpolated = len(rows)
    elif bad.any():
        x = -np.log(p)
        u[bad] = np.interp(x[bad], x[~bad], u[~bad])
        v[bad] = np.interp(x[bad], x[~bad], v[~bad])
        winds_interpolated = int(bad.sum())
    else:
        winds_interpolated = 0

    z_arr = None
    if all(_finite(L.z) for L in rows):
        z_try = np.array([float(L.z) for L in rows], dtype=float)
        if np.all(np.diff(z_try) > 0):
            z_arr = z_try

    try:
        prof = Profile(p, T, q, u, v, z=z_arr)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    meta = {
        "levels_in": len(levels),
        "levels_used": int(p.size),
        "winds_interpolated": winds_interpolated,
        "heights": "provided" if z_arr is not None else "hydrostatic",
        "surface_p": float(p[0]),
        "top_p": float(p[-1]),
        "top_height_agl_m": float(prof.z_agl[-1]),
    }
    return prof, meta


def _sanitize(d: Dict[str, float]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for k, v in d.items():
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            continue
        out[k] = float(v)
    return out


@app.get("/health")
def health():
    return {"ok": True, "service": "skywatch-ai", "engine": "diagnostics"}


@app.post("/v1/diagnostics", response_model=DiagnosticsResponse)
def diagnostics(body: DiagnosticsRequest):
    hem = body.hemisphere.upper()
    if hem not in ("N", "S"):
        raise HTTPException(400, "hemisphere must be N or S")
    prof, meta = _profile_from_levels(
        body.levels,
        temp_unit=body.tempUnit,
        wind_unit=body.windUnit,
    )
    raw = compute_diagnostics(prof, hemisphere=hem, virtual=body.virtual)
    return DiagnosticsResponse(
        engine="skywatch-ai",
        hemisphere=hem,
        diagnostics=_sanitize(raw),
        meta=meta,
    )
