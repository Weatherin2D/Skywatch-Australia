"""V1 inference: Open-Meteo teacher prior + radiosonde observation tokens.

Falls back to self-prior only if the teacher fetch fails (offline / API down).
"""
from __future__ import annotations

import math
import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch

from . import thermo as th
from .constants import EPS
from .etl.build_sample import build_inference_sample
from .etl.openmeteo_teacher import fetch_teacher_column
from .nn.train import load_checkpoint
from .nn.model import V1SoundingModel
from .normalizer import Normalizer
from .profile import Profile

_MODEL: Optional[V1SoundingModel] = None
_NORM: Optional[Normalizer] = None
_CK: Optional[dict] = None
_DEVICE = torch.device("cpu")


def default_checkpoint_path() -> str:
    env = os.environ.get("SKYWATCH_AI_CHECKPOINT", "").strip()
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for rel in (
        "checkpoints/v1-etl.pt",
        "checkpoints/v1-synthetic.pt",
        "runs/synthetic-smoke/ckpt.pt",
    ):
        p = os.path.join(here, rel)
        if os.path.isfile(p):
            return p
    return os.path.join(here, "checkpoints/v1-etl.pt")


def load_model(path: Optional[str] = None, device: str = "cpu"):
    global _MODEL, _NORM, _CK, _DEVICE
    path = path or default_checkpoint_path()
    if not os.path.isfile(path):
        raise FileNotFoundError(f"checkpoint not found: {path}")
    _DEVICE = torch.device(device)
    _MODEL, _NORM, _CK = load_checkpoint(path, device=device, use_ema=True)
    _MODEL.eval()
    return _MODEL, _NORM, _CK


def model_ready() -> bool:
    return _MODEL is not None and _NORM is not None


def ensure_model(path: Optional[str] = None):
    if not model_ready():
        load_model(path)


def levels_to_sonde_column(
    levels: List[dict],
    *,
    temp_unit: str = "C",
    wind_unit: str = "ms",
) -> Dict[str, Any]:
    """JSON levels → native sonde column dict (surface→top)."""
    spd_scale = {"kt": 0.514444, "ms": 1.0, "kmh": 1 / 3.6, "mph": 0.44704}.get(
        wind_unit.lower(), 1.0
    )
    t_off = 273.15 if temp_unit.upper() == "C" else 0.0
    rows = sorted(levels, key=lambda L: float(L["p"]), reverse=True)
    p_list, T_list, Td_list, u_list, v_list, z_list = [], [], [], [], [], []
    for L in rows:
        p = float(L["p"])
        if not (50 < p <= 1100):
            continue
        t = float(L["t"]) + t_off
        td_raw = L.get("td")
        td = (float(td_raw) + t_off) if td_raw is not None else t
        td = min(td, t)
        if L.get("u") is not None and L.get("v") is not None:
            u, v = float(L["u"]), float(L["v"])
        elif L.get("windDir") is not None and L.get("windSpd") is not None:
            ang = math.radians(float(L["windDir"]))
            spd = float(L["windSpd"]) * spd_scale
            u, v = -spd * math.sin(ang), -spd * math.cos(ang)
        else:
            u = v = float("nan")
        z = L.get("z")
        p_list.append(p)
        T_list.append(t)
        Td_list.append(td)
        u_list.append(u)
        v_list.append(v)
        z_list.append(float(z) if z is not None and math.isfinite(float(z)) else float("nan"))

    if len(p_list) < 3:
        raise ValueError("need at least 3 valid levels")

    p = np.asarray(p_list, float)
    _, uniq = np.unique(p, return_index=True)
    uniq = np.sort(uniq)
    p = p[uniq]
    T = np.asarray(T_list, float)[uniq]
    Td = np.asarray(Td_list, float)[uniq]
    u = np.asarray(u_list, float)[uniq]
    v = np.asarray(v_list, float)[uniq]
    z = np.asarray(z_list, float)[uniq]

    e = th.sat_vapor_pressure(Td)
    w = EPS * e / np.maximum(p - e, 1e-6)
    q = w / (1.0 + w)

    bad = ~(np.isfinite(u) & np.isfinite(v))
    if bad.all():
        u[:] = 0.0
        v[:] = 0.0
    elif bad.any():
        x = -np.log(p)
        u[bad] = np.interp(x[bad], x[~bad], u[~bad])
        v[bad] = np.interp(x[bad], x[~bad], v[~bad])

    if not (np.all(np.isfinite(z)) and np.all(np.diff(z) > 0)):
        z = Profile(p, T, q, u, v, z=None).z

    return {
        "p": p,
        "T": T,
        "q": q,
        "u": u,
        "v": v,
        "z": z,
        "p_sfc": float(p[0]),
    }


@torch.no_grad()
def predict_sample(sample: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    ensure_model()
    assert _MODEL is not None and _NORM is not None
    batch = {
        k: torch.as_tensor(np.asarray(v)[None], device=_DEVICE)
        for k, v in sample.items()
    }
    for k in ("tok_mask", "valid", "obs_mask", "surf_obs_mask", "persistence_valid"):
        if k in batch:
            batch[k] = batch[k].bool() if batch[k].dtype != torch.bool else batch[k]
    out = _MODEL(batch)
    return {k: v[0].float().cpu().numpy() for k, v in out.items()}


def decode_prediction(
    sample: Dict[str, np.ndarray],
    pred: Dict[str, np.ndarray],
    norm: Optional[Normalizer] = None,
) -> Dict[str, Any]:
    norm = norm or _NORM
    assert norm is not None
    valid = sample["valid"]
    native = norm.decode_profile(pred["mean"])
    surf = norm.decode_surface(pred["s_mean"])
    grid = norm.grid_p
    mask = valid & (grid >= 100.0)
    p = grid[mask]
    T = native[0, mask]
    q = np.exp(native[1, mask])
    u = native[2, mask]
    v = native[3, mask]
    Z = native[4, mask]
    Td = th.dewpoint(p, q)
    levels = []
    for i in range(len(p)):
        spd = float(math.hypot(u[i], v[i]))
        wdir = float(((270 - math.degrees(math.atan2(v[i], u[i]))) % 360 + 360) % 360)
        levels.append(
            {
                "p": float(p[i]),
                "t": float(T[i] - 273.15),
                "td": float(Td[i] - 273.15),
                "z": float(Z[i]),
                "windDir": wdir,
                "windSpd": spd,
                "u": float(u[i]),
                "v": float(v[i]),
            }
        )
    return {
        "levels": levels,
        "surface": {
            "T2m_C": float(surf[0] - 273.15),
            "q2m": float(np.exp(surf[1])),
            "u10": float(surf[2]),
            "v10": float(surf[3]),
            "p_sfc": float(surf[4]),
        },
        "scale_mean": float(np.mean(pred["scale"][:, mask])),
    }


def predict_from_levels(
    levels: List[dict],
    *,
    lat: float = -31.95,
    lon: float = 115.86,
    temp_unit: str = "C",
    wind_unit: str = "ms",
    hemisphere: str = "S",
    time_iso: Optional[str] = None,
    teacher_model: str = "pulse",
) -> Dict[str, Any]:
    from . import compute_diagnostics

    ensure_model()
    assert _NORM is not None and _CK is not None

    sonde = levels_to_sonde_column(levels, temp_unit=temp_unit, wind_unit=wind_unit)
    teacher_meta: Dict[str, Any] = {}
    teacher_mode = "open-meteo"
    teacher_history = None
    spatial_step = None
    try:
        from .etl.openmeteo_teacher import (
            fetch_teacher_window,
            spatial_step_deg,
            spatial_window_enabled,
        )
        from .synthetic import N_HIST, WINDOW

        if spatial_window_enabled():
            # Smaller window by default for latency; full WINDOW when step is coarse.
            win_n = 5 if spatial_step_deg() <= 0.25 else WINDOW
            win = fetch_teacher_window(
                lat,
                lon,
                model=teacher_model,
                time_iso=time_iso,
                window=win_n,
                n_hist=N_HIST,
            )
            teacher = win["center"]
            teacher_history = win.get("history")
            spatial_step = win.get("step_deg", spatial_step_deg())
            teacher_meta = {
                "source": teacher.get("source"),
                "model": teacher.get("model"),
                "valid_time": teacher.get("valid_time"),
                "spatial": bool(win.get("spatial")),
                "spatial_step_deg": spatial_step,
                "spatial_window": win.get("window"),
            }
        else:
            teacher = fetch_teacher_column(
                lat, lon, model=teacher_model, time_iso=time_iso, prefer_archive=False
            )
            teacher_meta = {
                "source": teacher.get("source"),
                "model": teacher.get("model"),
                "valid_time": teacher.get("valid_time"),
                "spatial": False,
            }
    except Exception as exc:  # noqa: BLE001
        try:
            teacher = fetch_teacher_column(
                lat, lon, model=teacher_model, time_iso=time_iso, prefer_archive=False
            )
            teacher_meta = {
                "source": teacher.get("source"),
                "model": teacher.get("model"),
                "valid_time": teacher.get("valid_time"),
                "spatial": False,
                "window_error": str(exc),
            }
        except Exception as exc2:  # noqa: BLE001
            # Offline / API failure — degrade to self-prior (documented).
            teacher = dict(sonde)
            teacher_mode = "self-prior-fallback"
            teacher_meta = {
                "error": str(exc2),
                "source": "self-prior-fallback",
                "spatial": False,
                "window_error": str(exc),
            }

    sample = build_inference_sample(
        teacher,
        sonde,
        lat=lat,
        lon=lon,
        norm=_NORM,
        teacher_history=teacher_history,
        spatial_step_deg=spatial_step,
    )
    pred = predict_sample(sample)
    decoded = decode_prediction(sample, pred, _NORM)

    p = np.array([L["p"] for L in decoded["levels"]])
    T = np.array([L["t"] for L in decoded["levels"]]) + 273.15
    Td = np.array([L["td"] for L in decoded["levels"]]) + 273.15
    u = np.array([L["u"] for L in decoded["levels"]])
    v = np.array([L["v"] for L in decoded["levels"]])
    z = np.array([L["z"] for L in decoded["levels"]])
    e = th.sat_vapor_pressure(np.minimum(Td, T))
    w = EPS * e / np.maximum(p - e, 1e-6)
    q = w / (1.0 + w)
    prof = Profile(p, T, q, u, v, z=z)
    diag = compute_diagnostics(prof, hemisphere=hemisphere.upper())
    diag = {
        k: float(v)
        for k, v in diag.items()
        if v is not None and math.isfinite(float(v))
    }

    disclaimer = (
        "SkyWatch AI V1 — Open-Meteo teacher + radiosonde obs. "
        "Not an official forecast. Skill depends on training data version."
    )
    if teacher_mode == "self-prior-fallback":
        disclaimer += " Teacher fetch failed; used self-prior fallback."

    return {
        "engine": "skywatch-ai-v1",
        "dataset_version": _CK.get("dataset_version", "unknown"),
        "step": _CK.get("step"),
        "teacher": teacher_meta,
        "teacher_mode": teacher_mode,
        "disclaimer": disclaimer,
        "levels": decoded["levels"],
        "surface": decoded["surface"],
        "diagnostics": diag,
        "uncertainty_scale_mean": decoded["scale_mean"],
        "lat": lat,
        "lon": lon,
        "hemisphere": hemisphere.upper(),
    }


def _teacher_to_level_dicts(teacher: Dict[str, Any]) -> List[dict]:
    """Native teacher column → JSON levels (°C, m/s) for predict_from_levels."""
    from . import thermo as th

    p = np.asarray(teacher["p"], float)
    T = np.asarray(teacher["T"], float)
    q = np.asarray(teacher["q"], float)
    u = np.asarray(teacher["u"], float)
    v = np.asarray(teacher["v"], float)
    z = np.asarray(teacher["z"], float)
    Td = th.dewpoint(p, q)
    out: List[dict] = []
    for i in range(len(p)):
        spd = float(math.hypot(u[i], v[i]))
        wdir = float(((270 - math.degrees(math.atan2(v[i], u[i]))) % 360 + 360) % 360)
        out.append(
            {
                "p": float(p[i]),
                "t": float(T[i] - 273.15),
                "td": float(Td[i] - 273.15),
                "z": float(z[i]),
                "windDir": wdir,
                "windSpd": spd,
                "u": float(u[i]),
                "v": float(v[i]),
            }
        )
    return out


def predict_from_location(
    *,
    lat: float = -31.95,
    lon: float = 115.86,
    hemisphere: str = "S",
    time_iso: Optional[str] = None,
    teacher_model: str = "pulse",
) -> Dict[str, Any]:
    """AI V1 sounding from lat/lon only — no Open-Meteo multi-level sounding required.

    Fetches a lean teacher column and uses it as the observation prior so the UI
    keeps working when the site's heavy pressure-level forecast API is 429'd.
    """
    ensure_model()
    teacher = fetch_teacher_column(
        lat, lon, model=teacher_model, time_iso=time_iso, prefer_archive=False
    )
    levels = _teacher_to_level_dicts(teacher)
    out = predict_from_levels(
        levels,
        lat=lat,
        lon=lon,
        temp_unit="C",
        wind_unit="ms",
        hemisphere=hemisphere,
        time_iso=time_iso or teacher.get("valid_time"),
        teacher_model=teacher_model,
    )
    out["teacher_mode"] = "open-meteo-point"
    out["disclaimer"] = (
        "SkyWatch AI V1 — Open-Meteo teacher column (point mode). "
        "Not an official forecast. Skill depends on training data version."
    )
    if out.get("teacher") is not None:
        out["teacher"] = {
            **out["teacher"],
            "point_mode": True,
            "valid_time": teacher.get("valid_time"),
        }
    out["valid_time"] = teacher.get("valid_time")
    return out


# Back-compat alias used by older call sites / tests
def build_sample_from_sounding(levels, norm, **kw):
    sonde = levels_to_sonde_column(
        levels,
        temp_unit=kw.get("temp_unit", "C"),
        wind_unit=kw.get("wind_unit", "ms"),
    )
    lat = kw.get("lat", -31.95)
    lon = kw.get("lon", 115.86)
    try:
        teacher = fetch_teacher_column(lat, lon, model="pulse")
    except Exception:  # noqa: BLE001
        teacher = dict(sonde)
    return build_inference_sample(teacher, sonde, lat=lat, lon=lon, norm=norm)
