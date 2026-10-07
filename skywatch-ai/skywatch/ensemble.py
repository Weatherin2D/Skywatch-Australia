"""Bridge from model output (normalised space) to the deterministic engine, plus V1 coherent sampling."""
from __future__ import annotations
from typing import Dict, Tuple
import numpy as np
from .grid import valid_levels
from .normalizer import Normalizer
from .profile import Profile
from .diagnostics import compute_diagnostics


def vertical_cholesky(n: int, length: float) -> np.ndarray:
    idx = np.arange(n)
    K = np.exp(-np.abs(idx[:, None] - idx[None, :]) / max(length, 1e-6))
    return np.linalg.cholesky(K + 1e-9 * np.eye(n))


def sample_normalized(mu, sigma, n_members: int, rng: np.random.Generator, length: float = 4.0):
    """Members (n,B,5,N) from independent-per-variable Gaussians whose errors are exponentially correlated in the
    vertical (length in levels): no per-level white noise (01 s11). V1 approximation of latent sampling (V5)."""
    L = vertical_cholesky(mu.shape[-1], length)
    eps = rng.standard_normal((n_members,) + mu.shape) @ L.T
    return mu[None] + sigma[None] * eps


def profile_from_normalized(norm: Normalizer, prof_n, surf_n, z_sfc: float = 0.0) -> Tuple[Profile, bool]:
    """One column (5,N)+(5,) -> engine Profile. Predicted Z is used when physically ordered, otherwise heights
    are rebuilt hydrostatically (second return value True = fallback used)."""
    grid = norm.grid_p
    prof, surf = norm.decode_profile(prof_n), norm.decode_surface(surf_n)
    T = np.clip(prof[0], 160.0, 335.0); q = np.clip(np.exp(prof[1]), 1e-6, 0.05)
    u, v, Z = prof[2], prof[3], prof[4]
    p_sfc = float(surf[4]); T2 = float(np.clip(surf[0], 160, 335)); q2 = float(np.clip(np.exp(surf[1]), 1e-6, 0.05))
    try:
        return Profile.from_levels(grid, T, q, u, v, Z, p_sfc=p_sfc, T2m=T2, q2m=q2, u10=float(surf[2]),
                                   v10=float(surf[3]), z_sfc=float(z_sfc)), False
    except ValueError:
        keep = grid < p_sfc - 0.5
        return Profile(np.concatenate([[p_sfc], grid[keep]]), np.concatenate([[T2], T[keep]]),
                       np.concatenate([[q2], q[keep]]), np.concatenate([[surf[2]], u[keep]]),
                       np.concatenate([[surf[3]], v[keep]])), True


def run_engine(norm: Normalizer, prof_n, surf_n, z_sfc, hemisphere: str = "S") -> Dict[str, np.ndarray]:
    """(B,5,N),(B,5),(B,) -> dict of (B,) diagnostics. Columns the engine cannot ingest give NaN rows."""
    rows, fallback = [], []
    for b in range(len(prof_n)):
        try:
            pr, fb = profile_from_normalized(norm, prof_n[b], surf_n[b], z_sfc[b])
            rows.append(compute_diagnostics(pr, hemisphere=hemisphere)); fallback.append(fb)
        except ValueError:
            rows.append(None); fallback.append(True)
    keys = next(r for r in rows if r is not None).keys()
    out = {k: np.array([r[k] if r is not None else np.nan for r in rows]) for k in keys}
    out["_fallback"] = np.array(fallback)
    out["_failed"] = np.array([r is None for r in rows])
    return out
