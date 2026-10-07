"""Training-sample contract (02 s21-22, s28). `validate_sample` is the automated pre-training check:
any ETL for BARRA2/ERA5/radiosondes must produce samples that pass it before they reach a model.

Shapes (N = n_levels, M = max_tokens, H=W=window, T=history, C=field channels):
  fields (T,C,H,W) f32 | static (S,H,W) f32 | tok_var,tok_src (M,) i64 | tok_feat (M,8) f32 | tok_mask (M,) bool
  teacher_profile, teacher_nearest, persistence_profile, target_profile, obs_target, obs_sigma (5,N) f32
  teacher_surface, persistence_surface, target_surface, surf_obs_target, surf_obs_sigma (5,) f32
  valid (N,) bool | obs_mask (5,N) bool | surf_obs_mask (5,) bool | persistence_valid () bool
  p_sfc_prior, z_sfc, event_weight () f32
All profile/surface arrays are in TRANSFORMED+NORMALISED space (see normalizer.py).
Below-ground levels (grid > surface pressure) of teacher_profile / teacher_nearest / persistence_profile /
target_profile and of every `fields` channel must be FILLED with the lowest valid level's value (grid.fill_below_ground),
never left as extrapolated reanalysis values.
`obs_target` must be observations that are NOT among the input tokens (held-out levels/stations/obs-dropout);
otherwise the observation loss degenerates into copying the input.
"""
from __future__ import annotations
from typing import List
import numpy as np
from .normalizer import Normalizer
from .obs_tokens import TOKEN_VARS, SOURCES, N_TOKEN_FEATS

PROFILE_KEYS = ("teacher_profile", "teacher_nearest", "persistence_profile", "target_profile", "obs_target", "obs_sigma")
SURFACE_KEYS = ("teacher_surface", "persistence_surface", "target_surface", "surf_obs_target", "surf_obs_sigma")
SCALAR_KEYS = ("persistence_valid", "p_sfc_prior", "z_sfc", "event_weight")
REQUIRED = ("fields", "static", "tok_var", "tok_src", "tok_feat", "tok_mask", "valid", "obs_mask", "surf_obs_mask") \
    + PROFILE_KEYS + SURFACE_KEYS + SCALAR_KEYS


def validate_sample(s, norm: Normalizer, max_abs_z: float = 12.0) -> List[str]:
    N = norm.grid_p.size
    errs: List[str] = []
    missing = [k for k in REQUIRED if k not in s]
    if missing:
        return [f"missing keys: {missing}"]
    for k in PROFILE_KEYS:
        if s[k].shape != (5, N): errs.append(f"{k}: shape {s[k].shape} != (5,{N})")
    for k in SURFACE_KEYS:
        if s[k].shape != (5,): errs.append(f"{k}: shape {s[k].shape} != (5,)")
    M = s["tok_mask"].shape[0]
    if s["tok_feat"].shape != (M, N_TOKEN_FEATS): errs.append(f"tok_feat shape {s['tok_feat'].shape}")
    if s["valid"].shape != (N,) or s["valid"].dtype != bool: errs.append("valid must be bool (N,)")
    if s["obs_mask"].shape != (5, N) or s["obs_mask"].dtype != bool: errs.append("obs_mask must be bool (5,N)")
    if errs:
        return errs
    for k in REQUIRED:
        a = np.asarray(s[k])
        if a.dtype.kind == "f" and not np.isfinite(a).all(): errs.append(f"{k}: non-finite values")
    if s["tok_mask"].any():
        if s["tok_var"][s["tok_mask"]].max() >= len(TOKEN_VARS) or s["tok_var"].min() < 0: errs.append("tok_var out of range")
        if s["tok_src"][s["tok_mask"]].max() >= len(SOURCES) or s["tok_src"].min() < 0: errs.append("tok_src out of range")
    expected_valid = norm.grid_p <= norm.decode_surface(s["target_surface"])[4]
    if not np.array_equal(expected_valid, s["valid"]): errs.append("valid != (grid <= target surface pressure)")
    if (s["obs_mask"] & ~s["valid"][None, :]).any(): errs.append("obs_mask set below ground")
    if (s["obs_sigma"][s["obs_mask"]] <= 0).any() or (s["surf_obs_sigma"][s["surf_obs_mask"]] <= 0).any():
        errs.append("observation uncertainty must be > 0 wherever an observation exists (02 s16)")
    v = s["valid"]
    k0 = int(np.argmax(v))
    for k in ("teacher_profile", "teacher_nearest", "persistence_profile", "target_profile"):
        if np.abs(s[k]).max() > max_abs_z: errs.append(f"{k}: |z| > {max_abs_z} (wrong units / normaliser / unfilled below-ground levels?)")
        if k0 > 0 and not np.allclose(s[k][:, :k0], s[k][:, k0:k0 + 1], atol=1e-5):
            errs.append(f"{k}: below-ground levels must be filled with the lowest valid level's value")
    for k in ("fields",):
        if np.abs(s[k]).max() > 3 * max_abs_z: errs.append(f"{k}: implausible magnitude")
    ph = norm.decode_profile(s["target_profile"])[:, v]
    if ph[0].min() < 150 or ph[0].max() > 340: errs.append("target T outside 150-340 K (units?)")
    if np.exp(ph[1]).max() > 0.1: errs.append("target q > 0.1 kg/kg")
    if np.hypot(ph[2], ph[3]).max() > 150: errs.append("target wind > 150 m/s")
    if np.any(np.diff(ph[4]) <= 0): errs.append("target Z not increasing with height")
    if not (400 <= float(s["p_sfc_prior"]) <= 1100): errs.append("p_sfc_prior outside 400-1100 hPa (units?)")
    if not (-500 <= float(s["z_sfc"]) <= 6000): errs.append("z_sfc outside -500..6000 m")
    return errs
