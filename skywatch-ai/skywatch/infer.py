"""Build a model sample from a physical sounding and run V1 inference.

Demo / bootstrap path: the input column is used as both the *teacher prior*
and the observation source. A real ETL will supply a true teacher (BARRA2 /
ERA5 / Open-Meteo) independent of held-out radiosonde obs.
"""
from __future__ import annotations

import math
import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch

from . import thermo as th
from .constants import EPS
from .grid import (
    fill_below_ground,
    interp_lnp,
    level_index,
    make_vertical_grid,
    valid_levels,
)
from .nn.model import V1SoundingModel
from .nn.train import load_checkpoint
from .normalizer import Normalizer, PROFILE_VARS, SURFACE_VARS
from .obs_tokens import DEFAULT_UNC, RawObs, encode_tokens, raw_from_sounding
from .profile import Profile
from .synthetic import IN_LEVELS, N_FIELD_CHANNELS, N_HIST, N_STATIC, WINDOW

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
        "checkpoints/v1-synthetic.pt",
        "runs/synthetic-smoke/ckpt.pt",
    ):
        p = os.path.join(here, rel)
        if os.path.isfile(p):
            return p
    return os.path.join(here, "checkpoints/v1-synthetic.pt")


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


def levels_to_arrays(
    levels: List[dict],
    *,
    temp_unit: str = "C",
    wind_unit: str = "ms",
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, Optional[np.ndarray]]:
    """Return p, T[K], q, u, v, z|None sorted surface→top."""
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
    # unique pressures
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

    z_out = None
    if np.all(np.isfinite(z)) and np.all(np.diff(z) > 0):
        z_out = z
    return p, T, q, u, v, z_out


def build_sample_from_sounding(
    levels: List[dict],
    norm: Normalizer,
    *,
    lat: float = -31.95,
    lon: float = 115.86,
    temp_unit: str = "C",
    wind_unit: str = "ms",
    max_tokens: int = 128,
    n_sig: int = 24,
) -> Dict[str, np.ndarray]:
    """Construct a contract-shaped sample for demo inference.

    Teacher prior = input column on the internal grid (no independent NWP yet).
    Observation tokens = thinned radiosonde from the same column (demo only —
    a real pipeline must hold out obs_target from input tokens).
    """
    p, T, q, u, v, z = levels_to_arrays(levels, temp_unit=temp_unit, wind_unit=wind_unit)
    grid = norm.grid_p
    p_sfc = float(p[0])
    z_sfc = float(z[0]) if z is not None else float(
        44330.77 * (1 - (p_sfc / 1013.25) ** 0.190263)
    )
    if z is None:
        prof_tmp = Profile(p, T, q, u, v, z=None)
        z = prof_tmp.z

    # native → transformed (5,N) then encode
    native = np.stack(
        [
            interp_lnp(grid, p, T),
            interp_lnp(grid, p, np.log(np.maximum(q, 1e-6))),
            interp_lnp(grid, p, u),
            interp_lnp(grid, p, v),
            z_sfc + interp_lnp(grid, p, z - z[0]),
        ]
    )
    valid = valid_levels(grid, p_sfc)
    teacher = fill_below_ground(native, valid)
    teacher_s = np.array([T[0], np.log(max(q[0], 1e-6)), u[0], v[0], p_sfc], float)

    tn = fill_below_ground(norm.encode_profile(teacher), valid)
    tsn = norm.encode_surface(teacher_s)

    rs = DEFAULT_UNC["radiosonde"]
    raw = raw_from_sounding(
        norm, p, T, q, u, v, lat=lat, lon=lon, time_h=-0.25, n_sig=n_sig
    )
    toks, _ = encode_tokens(raw, norm, lat0=lat, lon0=lon, max_tokens=max_tokens)

    # Held-out obs targets left empty for demo (avoid trivial copy in metrics UI)
    N = len(grid)
    obs_t = np.zeros((5, N), np.float32)
    obs_m = np.zeros((5, N), bool)
    obs_s = np.ones((5, N), np.float32)

    idx = level_index(grid, IN_LEVELS)
    H = W = WINDOW
    xs, ys = np.meshgrid(np.linspace(-1, 1, W), np.linspace(-1, 1, H))
    fields = np.zeros((N_HIST, N_FIELD_CHANNELS, H, W), np.float32)
    base = np.concatenate([tn[:, idx].reshape(-1), tsn[:4]])
    for t in range(N_HIST):
        fields[t] = base[:, None, None] + 0.02 * (t - (N_HIST - 1)) * xs[None]

    sf = np.zeros((N_STATIC, H, W), np.float32)
    sf[0] = z_sfc / 1000.0
    sf[5] = 1.0
    sf[6] = (lat + 25) / 15.0
    sf[7] = (lon - 134) / 20.0

    f32 = lambda a: np.asarray(a, np.float32)
    return dict(
        fields=fields,
        static=sf,
        **toks,
        teacher_profile=f32(tn),
        teacher_surface=f32(tsn),
        teacher_nearest=f32(tn),
        persistence_profile=f32(tn),
        persistence_surface=f32(tsn),
        persistence_valid=np.bool_(False),
        p_sfc_prior=np.float32(p_sfc),
        z_sfc=np.float32(z_sfc),
        valid=valid,
        target_profile=f32(tn),
        target_surface=f32(tsn),
        obs_target=obs_t,
        obs_mask=obs_m,
        obs_sigma=obs_s,
        surf_obs_target=np.zeros(5, np.float32),
        surf_obs_mask=np.zeros(5, bool),
        surf_obs_sigma=np.ones(5, np.float32),
        event_weight=np.float32(1.0),
    )


@torch.no_grad()
def predict_sample(sample: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    ensure_model()
    assert _MODEL is not None and _NORM is not None
    batch = {
        k: torch.as_tensor(np.asarray(v)[None], device=_DEVICE)
        for k, v in sample.items()
    }
    # bools
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
    """Decode normalised mean → physical levels + Profile-ready arrays."""
    norm = norm or _NORM
    assert norm is not None
    valid = sample["valid"]
    native = norm.decode_profile(pred["mean"])  # (5,N) T, lnq, u, v, Z
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
    # ensure surface→top decreasing p
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
) -> Dict[str, Any]:
    from . import compute_diagnostics

    ensure_model()
    assert _NORM is not None and _CK is not None
    sample = build_sample_from_sounding(
        levels,
        _NORM,
        lat=lat,
        lon=lon,
        temp_unit=temp_unit,
        wind_unit=wind_unit,
    )
    pred = predict_sample(sample)
    decoded = decode_prediction(sample, pred, _NORM)
    # Engine diagnostics on the predicted column
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
    return {
        "engine": "skywatch-ai-v1",
        "dataset_version": _CK.get("dataset_version", "unknown"),
        "step": _CK.get("step"),
        "disclaimer": (
            "Synthetic-trained V1 demo. Not calibrated on real weather. "
            "Teacher prior is the input column itself until real ETL is live."
        ),
        "levels": decoded["levels"],
        "surface": decoded["surface"],
        "diagnostics": diag,
        "uncertainty_scale_mean": decoded["scale_mean"],
        "lat": lat,
        "lon": lon,
        "hemisphere": hemisphere.upper(),
    }
