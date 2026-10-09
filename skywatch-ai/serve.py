"""SkyWatch AI sidecar — diagnostics engine + optional V1 neural predict.

  uvicorn serve:app --host 0.0.0.0 --port 43137

Endpoints:
  GET  /health
  POST /v1/diagnostics  — JSON profile → CAPE/SRH/… (numpy only)
  POST /v1/predict      — V1 sounding net (requires torch + checkpoint)
"""
from __future__ import annotations

import math
import os
import secrets
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from skywatch import Profile, compute_diagnostics
from skywatch import thermo as th
from skywatch.constants import EPS

_SPEED = {"kt": 0.514444, "ms": 1.0, "kmh": 1 / 3.6, "mph": 0.44704}
_ML_STATUS: Dict[str, Any] = {"ready": False, "error": None, "checkpoint": None}
_API_KEY = os.environ.get("SKYWATCH_AI_API_KEY", "").strip()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Eager-load V1 checkpoint when torch + file are available.
    try:
        import torch  # noqa: F401
        from skywatch.infer import default_checkpoint_path, load_model

        path = default_checkpoint_path()
        if os.path.isfile(path):
            load_model(path, device=os.environ.get("SKYWATCH_AI_DEVICE", "cpu"))
            _ML_STATUS.update(ready=True, checkpoint=path, error=None)
        else:
            _ML_STATUS.update(
                ready=False,
                checkpoint=path,
                error="checkpoint missing — run scripts/smoke_test.py",
            )
    except Exception as exc:  # noqa: BLE001 — report in /health
        _ML_STATUS.update(ready=False, error=str(exc))
    yield


app = FastAPI(
    title="SkyWatch AI",
    version="0.2.0",
    docs_url="/docs",
    lifespan=lifespan,
)


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    """Optional bearer gate when SKYWATCH_AI_API_KEY is set. /health stays open."""
    if not _API_KEY or request.url.path in ("/health", "/docs", "/openapi.json"):
        return await call_next(request)
    auth = request.headers.get("authorization") or ""
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = (request.headers.get("x-api-key") or "").strip()
    if not token or not secrets.compare_digest(token, _API_KEY):
        return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


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
    tempUnit: str = "C"
    windUnit: str = "ms"
    virtual: bool = True


class DiagnosticsResponse(BaseModel):
    engine: str = "skywatch-ai"
    hemisphere: str
    diagnostics: Dict[str, float]
    meta: Dict[str, Any]


class PredictRequest(BaseModel):
    levels: List[LevelIn]
    lat: float = -31.95
    lon: float = 115.86
    hemisphere: str = "S"
    tempUnit: str = "C"
    windUnit: str = "ms"
    time: Optional[str] = None  # ISO — aligns Open-Meteo teacher
    teacherModel: str = "pulse"


class PredictPointRequest(BaseModel):
    """Lat/lon-only AI V1 — skips the site's heavy Open-Meteo sounding fetch."""

    lat: float = -31.95
    lon: float = 115.86
    hemisphere: str = "S"
    time: Optional[str] = None
    teacherModel: str = "pulse"


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
    return {
        "ok": True,
        "service": "skywatch-ai",
        "engine": "diagnostics",
        "ml": _ML_STATUS,
        "auth_required": bool(_API_KEY),
    }


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


@app.post("/v1/predict")
def predict(body: PredictRequest):
    if not _ML_STATUS.get("ready"):
        raise HTTPException(
            503,
            f"V1 model unavailable: {_ML_STATUS.get('error') or 'not loaded'}",
        )
    hem = body.hemisphere.upper()
    if hem not in ("N", "S"):
        raise HTTPException(400, "hemisphere must be N or S")
    if len(body.levels) < 3:
        raise HTTPException(400, "profile needs at least 3 levels")
    try:
        from skywatch.infer import predict_from_levels

        levels = [L.model_dump() for L in body.levels]
        return predict_from_levels(
            levels,
            lat=body.lat,
            lon=body.lon,
            temp_unit=body.tempUnit,
            wind_unit=body.windUnit,
            hemisphere=hem,
            time_iso=body.time,
            teacher_model=body.teacherModel,
        )
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"predict failed: {exc}") from exc


@app.post("/v1/predict-point")
def predict_point(body: PredictPointRequest):
    if not _ML_STATUS.get("ready"):
        raise HTTPException(
            503,
            f"V1 model unavailable: {_ML_STATUS.get('error') or 'not loaded'}",
        )
    hem = body.hemisphere.upper()
    if hem not in ("N", "S"):
        raise HTTPException(400, "hemisphere must be N or S")
    try:
        from skywatch.infer import predict_from_location

        return predict_from_location(
            lat=body.lat,
            lon=body.lon,
            hemisphere=hem,
            time_iso=body.time,
            teacher_model=body.teacherModel,
        )
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"predict-point failed: {exc}") from exc
