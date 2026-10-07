"""Internal vertical grid (03 s6, 01 s7): finer than the user-facing standard levels."""
from __future__ import annotations
import numpy as np

STANDARD_LEVELS = np.array([1000., 950., 900., 850., 700., 500., 400., 300., 250., 200., 150., 100.])
# (start, stop, step) in hPa; ~90 m spacing in the lowest 250 hPa -> inversions survive
DEFAULT_SEGMENTS = ((1050., 800., 10.), (800., 500., 20.), (500., 200., 25.), (200., 100., 25.))


def make_vertical_grid(segments=DEFAULT_SEGMENTS) -> np.ndarray:
    parts = [np.arange(a, b, -s) for a, b, s in segments]
    g = np.concatenate(parts + [np.array([segments[-1][1]])])
    if not np.all(np.diff(g) < 0):
        raise ValueError("vertical grid must strictly decrease")
    return g


def level_index(grid: np.ndarray, levels) -> np.ndarray:
    """Index of each requested pressure in `grid`; raises if a level is not exactly on the grid."""
    levels = np.atleast_1d(np.asarray(levels, float))
    idx = np.array([int(np.argmin(np.abs(grid - p))) for p in levels])
    if np.any(np.abs(grid[idx] - levels) > 1e-9):
        raise ValueError("requested level(s) not on the grid")
    return idx


def valid_levels(grid: np.ndarray, p_sfc) -> np.ndarray:
    """True for levels at or above the ground. Works for scalar or array p_sfc (-> (..., N))."""
    return np.asarray(grid) <= np.asarray(p_sfc, float)[..., None]


def interp_lnp(grid_p, p_src, v_src):
    """Linear interpolation in ln(p), clamped at the ends. p_src may be in any order."""
    x = -np.log(np.asarray(p_src, float))
    o = np.argsort(x)
    return np.interp(-np.log(np.asarray(grid_p, float)), x[o], np.asarray(v_src, float)[o])


def fill_below_ground(x, valid):
    """Replace below-ground levels by the lowest valid level's value (x: (..., N) or (..., V, N); valid: (N,)).
    Reanalysis pressure-level data is extrapolated below ground; feeding that to a network gives 40-sigma inputs
    over high terrain. Losses ignore these levels via `valid`."""
    x = np.array(x, copy=True)
    k0 = int(np.argmax(valid))
    if k0 > 0:
        x[..., :k0] = x[..., k0:k0 + 1]
    return x
