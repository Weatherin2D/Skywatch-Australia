"""NumPy reference implementations of the loss mathematics. The torch losses in `nn/losses.py` implement
exactly these formulas; `tests/test_torch_parity.py` checks them against each other."""
from __future__ import annotations
import numpy as np
from scipy.special import erf
from .constants import RD, G, CPD, EPS
from . import thermo as th

HYDRO_SIGMA_M = 15.0
SUPERSAT_TOL = 1.05
SUPERADIABATIC_FACTOR = 1.1
GAMMA_D = G / CPD


def gaussian_crps(mu, sigma, y):
    z = (y - mu) / sigma
    cdf = 0.5 * (1.0 + erf(z / np.sqrt(2.0)))
    pdf = np.exp(-0.5 * z * z) / np.sqrt(2.0 * np.pi)
    return sigma * (z * (2.0 * cdf - 1.0) + 2.0 * pdf - 1.0 / np.sqrt(np.pi))


def vertical_gradient_l1(pred, target, valid):
    """Mean |d(pred) - d(target)| over adjacent-level pairs where both levels are valid. pred/target (B,V,N)."""
    dp, dt = pred[..., 1:] - pred[..., :-1], target[..., 1:] - target[..., :-1]
    m = (valid[:, None, 1:] & valid[:, None, :-1]) * np.ones_like(dp, bool)
    return float((np.abs(dp - dt) * m).sum() / max(m.sum(), 1))


def hydrostatic_residual(T, q, Z, p):
    """Metres. (Z_{k+1}-Z_k) - hydrostatic thickness from layer-mean virtual temperature. Arrays (..., N)."""
    Tv = T * (1.0 + 0.608 * q)
    thick = (RD / G) * 0.5 * (Tv[..., 1:] + Tv[..., :-1]) * (np.log(p[:-1]) - np.log(p[1:]))
    return (Z[..., 1:] - Z[..., :-1]) - thick


def supersaturation_excess(T, q, p):
    e = q * p / (EPS + (1.0 - EPS) * q)
    return np.maximum(e / th.sat_vapor_pressure(T) - SUPERSAT_TOL, 0.0)


def superadiabatic_excess(T, Z):
    gamma = -(T[..., 1:] - T[..., :-1]) / np.maximum(Z[..., 1:] - Z[..., :-1], 1.0)
    return np.maximum(gamma / GAMMA_D - SUPERADIABATIC_FACTOR, 0.0)
