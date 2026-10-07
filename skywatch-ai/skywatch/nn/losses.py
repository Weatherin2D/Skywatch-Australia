"""Training losses (03 s32-34): L = lT*L_teacher + lO*L_obs + lG*L_grad + lP*L_phys + lU*L_unc.
Math mirrors skywatch/lossmath.py (numpy reference); tests/test_torch_parity.py checks the two agree."""
from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Dict, Tuple
import torch
import torch.nn as nn
import torch.nn.functional as F

RD, G, CPD, EPS = 287.04749, 9.80665, 1004.6662, 0.6219569
GAMMA_D = G / CPD
HYDRO_SIGMA_M, SUPERSAT_TOL, SUPERSAT_SCALE, SUPERADIABATIC_FACTOR = 15.0, 1.05, 0.05, 1.1
_SQRT2, _INV_SQRT_PI, _INV_SQRT_2PI = math.sqrt(2.0), 1.0 / math.sqrt(math.pi), 1.0 / math.sqrt(2.0 * math.pi)


@dataclass
class LossConfig:
    var_weights: Tuple[float, ...] = (1.0, 1.0, 1.0, 1.0, 0.5)    # T, ln q, u, v, Z
    bl_boost: float = 1.0                                          # extra weight near the surface (80 hPa e-folding)
    surf_weight: float = 1.0
    grad_vars: int = 4                                             # gradient loss on T, ln q, u, v


class TorchNormalizer(nn.Module):
    """Moves a skywatch.Normalizer's statistics onto the device so losses can work in physical units."""

    def __init__(self, norm):
        super().__init__()
        for name in ("grid_p", "p_mean", "p_std", "s_mean", "s_std"):
            self.register_buffer(name, torch.tensor(getattr(norm, name), dtype=torch.float32))

    def decode_profile(self, x):
        return x * self.p_std + self.p_mean


def gaussian_crps(mu, sigma, y):
    z = (y - mu) / sigma
    cdf = 0.5 * (1.0 + torch.erf(z / _SQRT2))
    pdf = torch.exp(-0.5 * z * z) * _INV_SQRT_2PI
    return sigma * (z * (2.0 * cdf - 1.0) + 2.0 * pdf - _INV_SQRT_PI)


def wmean(x, w):
    return (x * w).sum() / w.sum().clamp_min(1e-6)


def level_weights(grid, p_sfc, bl_boost: float):
    return 1.0 + bl_boost * torch.exp(-(p_sfc[:, None] - grid[None, :]).clamp(min=0.0) / 80.0)


def _blend(mu, sigma, y, alpha):
    """(1-alpha)*MAE + alpha*CRPS: alpha ramps up so the scale head is not trained before the mean is sensible."""
    return (1.0 - alpha) * (mu - y).abs() + alpha * gaussian_crps(mu, sigma, y)


def teacher_loss(out, b, alpha, cfg: LossConfig, lw):
    valid = b["valid"][:, None, :].to(out["mean"].dtype)
    w = lw[:, None, :] * torch.tensor(cfg.var_weights, device=lw.device, dtype=lw.dtype)[None, :, None] * valid
    prof = wmean(_blend(out["mean"], out["scale"], b["target_profile"], alpha), w)
    surf = _blend(out["s_mean"], out["s_scale"], b["target_surface"], alpha).mean()
    return prof + cfg.surf_weight * surf


def obs_loss(out, b, alpha, cfg: LossConfig, lw):
    """Held-out observations; predictive spread is inflated by the observation's own uncertainty."""
    m = (b["obs_mask"] & b["valid"][:, None, :]).to(out["mean"].dtype)
    w = lw[:, None, :] * torch.tensor(cfg.var_weights, device=lw.device, dtype=lw.dtype)[None, :, None] * m
    sig = torch.sqrt(out["scale"] ** 2 + b["obs_sigma"] ** 2)
    prof = wmean(_blend(out["mean"], sig, b["obs_target"], alpha), w)
    sm = b["surf_obs_mask"].to(out["s_mean"].dtype)
    ssig = torch.sqrt(out["s_scale"] ** 2 + b["surf_obs_sigma"] ** 2)
    surf = wmean(_blend(out["s_mean"], ssig, b["surf_obs_target"], alpha), sm)
    return prof + cfg.surf_weight * surf


def gradient_loss(out, b, cfg: LossConfig, lw):
    """Sharpness: match vertical differences of the target (keeps inversions / jets / moisture steps)."""
    k = cfg.grad_vars
    dp = out["mean"][:, :k, 1:] - out["mean"][:, :k, :-1]
    dt = b["target_profile"][:, :k, 1:] - b["target_profile"][:, :k, :-1]
    pair = (b["valid"][:, 1:] & b["valid"][:, :-1]).to(dp.dtype)
    w = (0.5 * (lw[:, 1:] + lw[:, :-1]) * pair)[:, None, :]
    return wmean((dp - dt).abs(), w.expand_as(dp))


def physics_terms(mean, b, norm_t: TorchNormalizer):
    """Residuals of the *mean* profile in physical units. Returns (hydro_resid_m, supersat_excess, superadiabatic_excess)."""
    P = norm_t.decode_profile(mean)
    T, q, Z = P[:, 0], torch.exp(P[:, 1]).clamp(max=0.1), P[:, 4]
    p = norm_t.grid_p[None, :]
    lnp = torch.log(norm_t.grid_p)
    Tv = T * (1.0 + 0.608 * q)
    thick = (RD / G) * 0.5 * (Tv[:, 1:] + Tv[:, :-1]) * (lnp[:-1] - lnp[1:])[None, :]
    hydro = (Z[:, 1:] - Z[:, :-1]) - thick
    e = q * p / (EPS + (1.0 - EPS) * q)
    es = 6.112 * torch.exp(17.67 * (T - 273.15) / (T - 273.15 + 243.5))
    supersat = F.relu(e / es - SUPERSAT_TOL)
    gamma = -(T[:, 1:] - T[:, :-1]) / (Z[:, 1:] - Z[:, :-1]).clamp(min=1.0)
    superad = F.relu(gamma / GAMMA_D - SUPERADIABATIC_FACTOR)
    return hydro, supersat, superad


def physics_loss(out, b, norm_t: TorchNormalizer):
    hydro, supersat, superad = physics_terms(out["mean"], b, norm_t)
    valid = b["valid"]
    pair = (valid[:, 1:] & valid[:, :-1]).to(hydro.dtype)
    free = pair * (norm_t.grid_p[None, 1:] < (b["p_sfc_prior"][:, None] - 30.0)).to(hydro.dtype)   # allow surface-layer superadiabat
    l_h = wmean(F.smooth_l1_loss(hydro / HYDRO_SIGMA_M, torch.zeros_like(hydro), reduction="none"), pair)
    l_s = wmean((supersat / SUPERSAT_SCALE) ** 2, valid.to(supersat.dtype))
    l_a = wmean(superad ** 2, free)
    return l_h + l_s + l_a, dict(hydro=l_h.detach(), supersat=l_s.detach(), superadiabatic=l_a.detach())


def calibration_loss(out, b, norm_t: TorchNormalizer):
    """Pushes the batch-mean of z^2 towards 1 per variable and vertical band (gradient reaches the scale only)."""
    z2 = ((b["target_profile"] - out["mean"]).detach() / out["scale"]) ** 2          # (B,5,N)
    g = norm_t.grid_p
    bands = torch.stack([g >= 800.0, (g < 800.0) & (g >= 400.0), g < 400.0])          # (3,N)
    m = (b["valid"][:, None, None, :] & bands[None, None, :, :]).to(z2.dtype)         # (B,1,3,N)
    num = (z2[:, :, None, :] * m).sum(dim=(0, 3))                                      # (5,3)
    cnt = m.sum(dim=(0, 3))                                                            # (1,3)
    present = (cnt > 0).to(z2.dtype).expand_as(num)
    return (torch.log((num / cnt.clamp_min(1.0)).clamp_min(1e-6)) ** 2 * present).sum() / present.sum().clamp_min(1.0)


def total_loss(out, b, w: Dict[str, float], cfg: LossConfig, norm_t: TorchNormalizer):
    """w: weights from LossSchedule.weights(step). Terms with zero weight are skipped (not computed)."""
    lw = level_weights(norm_t.grid_p, b["p_sfc_prior"], cfg.bl_boost) * b["valid"].to(out["mean"].dtype)
    zero = out["mean"].new_zeros(())
    parts = {"teacher": teacher_loss(out, b, w["alpha"], cfg, lw)}
    parts["obs"] = obs_loss(out, b, w["alpha"], cfg, lw) if w["obs"] > 0 else zero
    parts["grad"] = gradient_loss(out, b, cfg, lw) if w["grad"] > 0 else zero
    if w["phys"] > 0:
        parts["phys"], sub = physics_loss(out, b, norm_t)
        parts.update({f"phys_{k}": v for k, v in sub.items()})
    else:
        parts["phys"] = zero
    parts["unc"] = calibration_loss(out, b, norm_t) if w["unc"] > 0 else zero
    total = (w["teacher"] * parts["teacher"] + w["obs"] * parts["obs"] + w["grad"] * parts["grad"]
             + w["phys"] * parts["phys"] + w["unc"] * parts["unc"])
    parts["total"] = total
    return total, {k: float(v.detach()) for k, v in parts.items()}
