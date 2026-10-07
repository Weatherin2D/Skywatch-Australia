"""Per-(variable, level) normalisation. Specific humidity is modelled as ln(q) so q > 0 by construction."""
from __future__ import annotations
import numpy as np
from .grid import interp_lnp

PROFILE_VARS = ("T", "q", "u", "v", "Z")          # T [K], q [kg/kg], u,v [m/s], Z geopotential height [m]
SURFACE_VARS = ("T2m", "q2m", "u10", "v10", "p_sfc")
Q_FLOOR = 1e-6
_EXTRA = {"gust": (8.0, 6.0), "rain": (0.3, 0.8)}   # rain is log1p(mm/h)
_LOGQ = ("q", "q2m")


def to_transformed(var: str, x):
    x = np.asarray(x, float)
    if var in _LOGQ:
        return np.log(np.maximum(x, Q_FLOOR))
    if var == "rain":
        return np.log1p(np.maximum(x, 0.0))
    return x


def from_transformed(var: str, x):
    x = np.asarray(x, float)
    if var in _LOGQ:
        return np.exp(x)
    if var == "rain":
        return np.expm1(x)
    return x


class Normalizer:
    def __init__(self, grid_p, p_mean, p_std, s_mean, s_std):
        self.grid_p = np.asarray(grid_p, float)
        self.p_mean, self.p_std = np.asarray(p_mean, float), np.asarray(p_std, float)
        self.s_mean, self.s_std = np.asarray(s_mean, float), np.asarray(s_std, float)
        n = self.grid_p.size
        assert self.p_mean.shape == self.p_std.shape == (len(PROFILE_VARS), n)
        assert self.s_mean.shape == self.s_std.shape == (len(SURFACE_VARS),)
        assert np.all(self.p_std > 0) and np.all(self.s_std > 0)

    # ---- construction
    @classmethod
    def default(cls, grid_p):
        """Rough climatology for smoke tests. Use `fit` on real data."""
        p = np.asarray(grid_p, float)
        Tm = np.where(p > 226.32, 288.15 * (p / 1013.25) ** 0.190263, 216.65)
        Zm = np.where(p > 226.32, 44330.77 * (1 - (p / 1013.25) ** 0.190263),
                      11000.0 + 6341.6 * np.log(226.32 / p))
        qm = np.log(np.maximum(0.016 * (p / 1000.0) ** 3, 2e-6))
        jet = np.exp(-(((p - 250.0) / 180.0) ** 2))
        mean = np.stack([Tm, qm, 14.0 * jet, 0.0 * p, Zm])
        std = np.stack([4.0 + 3.0 * np.clip(p / 1000.0, 0, 1.2), 0.8 + 0.5 * (1 - p / 1050.0),
                        6.0 + 8.0 * jet, 5.0 + 5.0 * jet, 50.0 + 330.0 * (1 - p / 1050.0)])
        return cls(p, mean, std, [289.0, np.log(0.009), 0.0, 0.0, 1005.0], [8.0, 0.7, 4.0, 4.0, 15.0])

    @classmethod
    def fit(cls, grid_p, profiles, valid, surfaces, min_std=1e-3):
        """profiles (S,5,N) in TRANSFORMED space, valid (S,N) bool, surfaces (S,5)."""
        w = valid[:, None, :].astype(float)
        cnt = np.maximum(w.sum(0), 1.0)
        mean = (profiles * w).sum(0) / cnt
        std = np.sqrt((((profiles - mean) ** 2) * w).sum(0) / cnt)
        return cls(grid_p, mean, np.maximum(std, min_std), surfaces.mean(0), np.maximum(surfaces.std(0), min_std))

    # ---- arrays (…,5,N) / (…,5)
    def encode_profile(self, x):
        return (np.asarray(x, float) - self.p_mean) / self.p_std

    def decode_profile(self, x):
        return np.asarray(x, float) * self.p_std + self.p_mean

    def encode_surface(self, x):
        return (np.asarray(x, float) - self.s_mean) / self.s_std

    def decode_surface(self, x):
        return np.asarray(x, float) * self.s_std + self.s_mean

    # ---- single values (used for observation tokens). p in hPa, NaN/None for surface variables
    def stats_at(self, var: str, p=None):
        if var in PROFILE_VARS:
            i = PROFILE_VARS.index(var)
            return interp_lnp(p, self.grid_p, self.p_mean[i]), interp_lnp(p, self.grid_p, self.p_std[i])
        if var in SURFACE_VARS:
            i = SURFACE_VARS.index(var)
            return self.s_mean[i], self.s_std[i]
        if var in _EXTRA:
            return _EXTRA[var]
        raise KeyError(var)

    def encode_value(self, var: str, value, p=None):
        m, s = self.stats_at(var, p)
        return (to_transformed(var, value) - m) / s

    def encode_sigma(self, var: str, unc, value, p=None):
        """Observation uncertainty (physical units; for humidity a *physical* q error) -> normalised sigma."""
        _, s = self.stats_at(var, p)
        unc = np.asarray(unc, float)
        if var in _LOGQ:
            unc = unc / np.maximum(np.asarray(value, float), Q_FLOOR)       # relative error == ln-space sigma
        return unc / s

    # ---- (de)serialisation for checkpoints
    def to_dict(self):
        return {k: np.asarray(getattr(self, k)).tolist() for k in ("grid_p", "p_mean", "p_std", "s_mean", "s_std")}

    @classmethod
    def from_dict(cls, d):
        return cls(**{k: np.asarray(v, float) for k, v in d.items()})
