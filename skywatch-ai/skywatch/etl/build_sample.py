"""Assemble a `contract.validate_sample`-compliant training example.

Teacher (Open-Meteo) and radiosonde (UWYO) are independent:
  - Input tokens come from the radiosonde (thinned).
  - `obs_target` is a *held-out* dense interpolation of the radiosonde with
    independent noise so the observation loss cannot trivially copy tokens.
  - `target_profile` is the radiosonde on the internal grid (truth for AU).
  - `teacher_profile` is the Open-Meteo column (prior the net corrects).
"""
from __future__ import annotations

import math
from typing import Any, Dict, Optional

import numpy as np

from skywatch.contract import validate_sample
from skywatch.evaluate import inversion_strength
from skywatch.grid import (
    fill_below_ground,
    interp_lnp,
    level_index,
    make_vertical_grid,
    valid_levels,
)
from skywatch.normalizer import Normalizer, SURFACE_VARS
from skywatch.obs_tokens import DEFAULT_UNC, encode_tokens, raw_from_sounding, raw_surface
from skywatch.profile import Profile
from skywatch.synthetic import IN_LEVELS, N_FIELD_CHANNELS, N_HIST, N_STATIC, WINDOW


def event_weight_from_sonde(
    sonde: Dict[str, Any],
    *,
    hemisphere: str = "S",
    cape_hi: float = 2000.0,
    cape_mid: float = 500.0,
    inv_k: float = 1.5,
) -> float:
    """Stage-6 oversampling weight from truth-column CAPE / inversion strength."""
    w = 1.0
    try:
        prof = Profile(
            sonde["p"], sonde["T"], sonde["q"], sonde["u"], sonde["v"], z=sonde["z"]
        )
        from skywatch import compute_diagnostics

        diag = compute_diagnostics(prof, hemisphere=hemisphere.upper())
        sbcape = float(diag.get("SBCAPE") or 0.0)
        if math.isfinite(sbcape):
            if sbcape > cape_hi:
                w *= 4.0
            elif sbcape > cape_mid:
                w *= 2.0
        strength, _ = inversion_strength(prof.T, prof.z_agl)
        if math.isfinite(strength) and strength >= inv_k:
            w *= 2.5
    except Exception:  # noqa: BLE001 — keep baseline weight
        return 1.0
    return float(w)


def _column_to_native(col: Dict[str, np.ndarray], grid_p, z_sfc: float):
    prof = np.stack(
        [
            interp_lnp(grid_p, col["p"], col["T"]),
            interp_lnp(grid_p, col["p"], np.log(np.maximum(col["q"], 1e-6))),
            interp_lnp(grid_p, col["p"], col["u"]),
            interp_lnp(grid_p, col["p"], col["v"]),
            z_sfc + interp_lnp(grid_p, col["p"], col["z"] - col["z"][0]),
        ]
    )
    return prof


def build_training_sample(
    teacher: Dict[str, Any],
    sonde: Dict[str, Any],
    *,
    lat: float,
    lon: float,
    norm: Optional[Normalizer] = None,
    rng: Optional[np.random.Generator] = None,
    max_tokens: int = 128,
    n_sig: int = 24,
) -> Dict[str, np.ndarray]:
    rng = rng or np.random.default_rng(0)
    grid = make_vertical_grid()
    norm = norm or Normalizer.default(grid)
    N = len(grid)

    p_sfc = float(sonde["p_sfc"])
    z_sfc = float(sonde["z"][0])
    valid = valid_levels(grid, p_sfc)

    truth = fill_below_ground(_column_to_native(sonde, grid, z_sfc), valid)
    truth_s = np.array(
        [
            sonde["T"][0],
            np.log(max(float(sonde["q"][0]), 1e-6)),
            sonde["u"][0],
            sonde["v"][0],
            p_sfc,
        ],
        float,
    )

    teach = fill_below_ground(_column_to_native(teacher, grid, z_sfc), valid)
    teach_s = np.array(
        [
            teacher["T"][0],
            np.log(max(float(teacher["q"][0]), 1e-6)),
            teacher["u"][0],
            teacher["v"][0],
            float(teacher["p_sfc"]),
        ],
        float,
    )

    # persistence ≈ previous teacher with noise (no true t-1 yet)
    persist = teach + rng.normal(0, 1, teach.shape) * (0.15 * norm.p_std)
    persist_s = teach_s + rng.normal(0, 1, 5) * 0.3 * norm.s_std
    nearest = teach + rng.normal(0, 1, teach.shape) * (0.08 * norm.p_std)

    rs = DEFAULT_UNC["radiosonde"]
    # Input tokens — realisation A
    Ta = sonde["T"] + rng.normal(0, rs["T"], sonde["T"].size)
    qa = sonde["q"] * np.exp(rng.normal(0, rs["q"], sonde["q"].size))
    ua = sonde["u"] + rng.normal(0, rs["u"], sonde["u"].size)
    va = sonde["v"] + rng.normal(0, rs["v"], sonde["v"].size)
    raw = raw_from_sounding(
        norm,
        sonde["p"],
        Ta,
        qa,
        ua,
        va,
        lat=lat,
        lon=lon,
        time_h=-0.5,
        n_sig=n_sig,
        z=sonde["z"],
    )
    toks, _ = encode_tokens(raw, norm, lat0=lat, lon0=lon, max_tokens=max_tokens)

    # Held-out dense obs target — realisation B (must NOT match input tokens)
    Tb = sonde["T"] + rng.normal(0, rs["T"], sonde["T"].size)
    qb = sonde["q"] * np.exp(rng.normal(0, rs["q"], sonde["q"].size))
    ub = sonde["u"] + rng.normal(0, rs["u"], sonde["u"].size)
    vb = sonde["v"] + rng.normal(0, rs["v"], sonde["v"].size)
    obs_t = np.zeros((5, N), np.float32)
    obs_m = np.zeros((5, N), bool)
    obs_s = np.ones((5, N), np.float32)
    for i, (var, arr, sig_phys) in enumerate(
        (
            ("T", Tb, rs["T"]),
            ("q", qb, None),
            ("u", ub, rs["u"]),
            ("v", vb, rs["v"]),
        )
    ):
        obs_t[i] = interp_lnp(
            grid, sonde["p"], norm.encode_value(var, arr, sonde["p"])
        )
        if var == "q":
            sig = norm.encode_sigma(var, rs["q"] * arr, arr, sonde["p"])
        else:
            sig = norm.encode_sigma(var, sig_phys, arr, sonde["p"])
        obs_s[i] = interp_lnp(grid, sonde["p"], sig)
        obs_m[i] = valid & (grid >= sonde["p"][-1])

    # Surface AWS-ish from sonde surface
    au = DEFAULT_UNC["aws"]
    surf_vals = {
        "T2m": float(truth_s[0] + rng.normal(0, au["T2m"])),
        "q2m": float(np.exp(truth_s[1] + rng.normal(0, au["q2m"]))),
        "u10": float(truth_s[2] + rng.normal(0, au["u10"])),
        "v10": float(truth_s[3] + rng.normal(0, au["v10"])),
        "p_sfc": float(truth_s[4] + rng.normal(0, au["p_sfc"])),
    }
    raw_s = raw_surface(norm, surf_vals, lat=lat, lon=lon, time_h=-0.1)
    # merge surface tokens into pad (re-encode combined)
    from skywatch.obs_tokens import RawObs

    toks, _ = encode_tokens(
        RawObs.concat([raw, raw_s]),
        norm,
        lat0=lat,
        lon0=lon,
        max_tokens=max_tokens,
    )
    surf_t = np.zeros(5, np.float32)
    surf_m = np.zeros(5, bool)
    surf_s = np.ones(5, np.float32)
    held = {
        "T2m": float(truth_s[0] + rng.normal(0, au["T2m"])),
        "q2m": float(np.exp(truth_s[1] + rng.normal(0, au["q2m"]))),
        "u10": float(truth_s[2] + rng.normal(0, au["u10"])),
        "v10": float(truth_s[3] + rng.normal(0, au["v10"])),
        "p_sfc": float(truth_s[4] + rng.normal(0, au["p_sfc"])),
    }
    for i, var in enumerate(SURFACE_VARS):
        surf_t[i] = norm.encode_value(var, held[var])
        surf_m[i] = True
        surf_s[i] = norm.encode_sigma(
            var,
            au[var] * (held[var] if var == "q2m" else 1.0),
            held[var],
        )

    tn = fill_below_ground(norm.encode_profile(teach), valid)
    tsn = norm.encode_surface(teach_s)
    idx = level_index(grid, IN_LEVELS)
    H = W = WINDOW
    xs, ys = np.meshgrid(np.linspace(-1, 1, W), np.linspace(-1, 1, H))
    fields = np.zeros((N_HIST, N_FIELD_CHANNELS, H, W), np.float32)
    base = np.concatenate([tn[:, idx].reshape(-1), tsn[:4]])
    for t in range(N_HIST):
        fields[t] = base[:, None, None] + 0.05 * (t - (N_HIST - 1)) * xs[None]

    sf = np.zeros((N_STATIC, H, W), np.float32)
    sf[0] = z_sfc / 1000.0
    sf[5] = 1.0
    sf[6] = (lat + 25) / 15.0
    sf[7] = (lon - 134) / 20.0

    f32 = lambda a: np.asarray(a, np.float32)
    sample = dict(
        fields=fields,
        static=sf,
        **toks,
        teacher_profile=f32(tn),
        teacher_surface=f32(tsn),
        teacher_nearest=f32(fill_below_ground(norm.encode_profile(nearest), valid)),
        persistence_profile=f32(fill_below_ground(norm.encode_profile(persist), valid)),
        persistence_surface=f32(norm.encode_surface(persist_s)),
        persistence_valid=np.bool_(True),
        p_sfc_prior=np.float32(teach_s[4]),
        z_sfc=np.float32(z_sfc),
        valid=valid,
        target_profile=f32(fill_below_ground(norm.encode_profile(truth), valid)),
        target_surface=f32(norm.encode_surface(truth_s)),
        obs_target=f32(obs_t),
        obs_mask=obs_m,
        obs_sigma=f32(obs_s),
        surf_obs_target=f32(surf_t),
        surf_obs_mask=surf_m,
        surf_obs_sigma=f32(surf_s),
        event_weight=np.float32(event_weight_from_sonde(sonde)),
    )
    errs = validate_sample(sample, norm)
    if errs:
        raise ValueError("sample failed contract: " + "; ".join(errs[:8]))
    return sample


def build_inference_sample(
    teacher: Dict[str, Any],
    sonde: Dict[str, Any],
    *,
    lat: float,
    lon: float,
    norm: Optional[Normalizer] = None,
    max_tokens: int = 128,
    n_sig: int = 24,
) -> Dict[str, np.ndarray]:
    """Forward-pass sample: Open-Meteo teacher prior + radiosonde observation tokens.

    No held-out obs_target (inference). Teacher and sonde must be independent columns.
    """
    grid = make_vertical_grid()
    norm = norm or Normalizer.default(grid)
    N = len(grid)

    p_sfc = float(sonde["p_sfc"])
    z_sfc = float(sonde["z"][0])
    valid = valid_levels(grid, p_sfc)

    teach = fill_below_ground(_column_to_native(teacher, grid, z_sfc), valid)
    teach_s = np.array(
        [
            teacher["T"][0],
            np.log(max(float(teacher["q"][0]), 1e-6)),
            teacher["u"][0],
            teacher["v"][0],
            float(teacher["p_sfc"]),
        ],
        float,
    )
    # Target unused at inference — fill with sonde for contract shape if needed.
    truth = fill_below_ground(_column_to_native(sonde, grid, z_sfc), valid)
    truth_s = np.array(
        [
            sonde["T"][0],
            np.log(max(float(sonde["q"][0]), 1e-6)),
            sonde["u"][0],
            sonde["v"][0],
            p_sfc,
        ],
        float,
    )

    raw = raw_from_sounding(
        norm,
        sonde["p"],
        sonde["T"],
        sonde["q"],
        sonde["u"],
        sonde["v"],
        lat=lat,
        lon=lon,
        time_h=-0.25,
        n_sig=n_sig,
        z=sonde["z"],
    )
    toks, _ = encode_tokens(raw, norm, lat0=lat, lon0=lon, max_tokens=max_tokens)

    tn = fill_below_ground(norm.encode_profile(teach), valid)
    tsn = norm.encode_surface(teach_s)
    idx = level_index(grid, IN_LEVELS)
    H = W = WINDOW
    xs, _ys = np.meshgrid(np.linspace(-1, 1, W), np.linspace(-1, 1, H))
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
        p_sfc_prior=np.float32(teach_s[4]),
        z_sfc=np.float32(z_sfc),
        valid=valid,
        target_profile=f32(fill_below_ground(norm.encode_profile(truth), valid)),
        target_surface=f32(norm.encode_surface(truth_s)),
        obs_target=np.zeros((5, N), np.float32),
        obs_mask=np.zeros((5, N), bool),
        obs_sigma=np.ones((5, N), np.float32),
        surf_obs_target=np.zeros(5, np.float32),
        surf_obs_mask=np.zeros(5, bool),
        surf_obs_sigma=np.ones(5, np.float32),
        event_weight=np.float32(1.0),
    )
