"""Atmospheric column container used by the diagnostics engine.

Conventions
-----------
* Index 0 is the surface; pressure strictly decreases with index.
* p [hPa], T [K], q specific humidity [kg/kg], u/v [m/s], z geopotential height
  above mean sea level [m]. If z is omitted it is built hydrostatically from the
  virtual temperature, anchored at z0.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import numpy as np
from .constants import RD, G
from .thermo import mixing_ratio_from_q, virtual_temperature


def hydrostatic_heights(p, T, q, z0: float = 0.0):
    p = np.asarray(p, float)
    Tv = virtual_temperature(T, mixing_ratio_from_q(q))
    dlnp = np.log(p[:-1]) - np.log(p[1:])
    dz = (RD / G) * 0.5 * (Tv[:-1] + Tv[1:]) * dlnp
    return z0 + np.concatenate([[0.0], np.cumsum(dz)])


@dataclass
class Profile:
    p: np.ndarray
    T: np.ndarray
    q: np.ndarray
    u: np.ndarray
    v: np.ndarray
    z: Optional[np.ndarray] = None
    z_agl: np.ndarray = field(init=False)

    def __post_init__(self):
        self.p, self.T, self.q, self.u, self.v = (
            np.asarray(a, dtype=float) for a in (self.p, self.T, self.q, self.u, self.v))
        n = self.p.size
        if n < 3:
            raise ValueError("profile needs at least 3 levels")
        for name in ("T", "q", "u", "v"):
            if getattr(self, name).shape != self.p.shape:
                raise ValueError(f"{name} shape {getattr(self, name).shape} != p shape {self.p.shape}")
        if not all(np.isfinite(a).all() for a in (self.p, self.T, self.q, self.u, self.v)):
            raise ValueError("non-finite values in profile")
        if np.any(np.diff(self.p) >= 0):
            raise ValueError("pressure must strictly decrease with index (index 0 = surface)")
        if np.any(self.q < 0) or np.any(self.q > 0.1):
            raise ValueError("specific humidity outside [0, 0.1] kg/kg")
        if np.any(self.T < 150) or np.any(self.T > 340):
            raise ValueError("temperature outside physically plausible range 150-340 K")
        if self.z is None:
            self.z = hydrostatic_heights(self.p, self.T, self.q)
        else:
            self.z = np.asarray(self.z, dtype=float)
            if self.z.shape != self.p.shape or np.any(np.diff(self.z) <= 0):
                raise ValueError("z must match p and strictly increase with index")
        self.z_agl = self.z - self.z[0]

    @classmethod
    def from_levels(cls, p_lev, T, q, u, v, z, *, p_sfc, T2m, q2m, u10, v10, z_sfc):
        """Build a column from fixed pressure levels plus surface values.

        Levels at or below the ground (p >= p_sfc - 0.5 hPa) are dropped and the
        surface observation becomes index 0 - this is how pressure-level model
        output is handled over elevated terrain."""
        p_lev = np.asarray(p_lev, float)
        keep = p_lev < (p_sfc - 0.5)
        order = np.argsort(-p_lev[keep])
        def sel(a): return np.asarray(a, float)[keep][order]
        return cls(
            p=np.concatenate([[p_sfc], sel(p_lev)]),
            T=np.concatenate([[T2m], sel(T)]),
            q=np.concatenate([[q2m], sel(q)]),
            u=np.concatenate([[u10], sel(u)]),
            v=np.concatenate([[v10], sel(v)]),
            z=np.concatenate([[z_sfc], sel(z)]),
        )
