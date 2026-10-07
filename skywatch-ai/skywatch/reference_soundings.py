"""Analytic reference soundings used to validate the engine (and later, as
benchmark cases for 03_V1_SOUNDING_MODEL s21)."""
from __future__ import annotations
import numpy as np
from .constants import G, CPD, RD, KAPPA, EPS
from .profile import Profile
from . import thermo as th


def isa_profile(z, u=None, v=None, q=1e-6):
    """International Standard Atmosphere (troposphere) on heights z [m]; u,v callables of z."""
    z = np.asarray(z, float)
    T = 288.15 - 0.0065 * z
    p = 1013.25 * (T / 288.15) ** 5.255
    uu = np.zeros_like(z) if u is None else np.asarray(u(z), float)
    vv = np.zeros_like(z) if v is None else np.asarray(v(z), float)
    return Profile(p, T, np.full_like(z, q), uu, vv, z=z.copy())


def weisman_klemp(dz=250.0, ztop=20000.0, q_sfc_cap=0.014):
    """Weisman & Klemp (1982) analytic thermodynamic profile, surface pressure 1000 hPa,
    boundary-layer mixing ratio capped at 14 g/kg. Literature CAPE ~2-2.5 kJ/kg."""
    z = np.arange(0.0, ztop + dz, dz)
    th0, th_tr, z_tr, T_tr = 300.0, 343.0, 12000.0, 213.0
    theta = np.where(z <= z_tr, th0 + (th_tr - th0) * (z / z_tr) ** 1.25,
                     th_tr * np.exp(G / (CPD * T_tr) * (z - z_tr)))
    rh = np.where(z <= z_tr, 1.0 - 0.75 * (z / z_tr) ** 1.25, 0.25)
    # hydrostatic Exner function: d(pi)/dz = -g/(cp*theta)  (trapezoid)
    inv = 1.0 / theta
    pi = 1.0 - (G / CPD) * np.concatenate([[0.0], np.cumsum(0.5 * (inv[1:] + inv[:-1]) * np.diff(z))])
    p = 1000.0 * pi ** (1.0 / KAPPA)
    T = theta * pi
    es = th.sat_vapor_pressure(T)
    e = rh * es
    w = np.minimum(EPS * e / (p - e), q_sfc_cap)
    keep = p >= 100.0
    return Profile(p[keep], T[keep], th.q_from_mixing_ratio(w[keep]),
                   np.zeros(keep.sum()), np.zeros(keep.sum()), z=z[keep])


def moist_adiabatic_env(p0=1000.0, T0_k=300.0, Td0_k=295.0, dp=25.0, p_top=150.0):
    """Environment that exactly follows the parcel path (dry below LCL, pseudo-adiabat
    above). The parcel should then have ~zero buoyancy everywhere -> CAPE ~ 0."""
    p = np.arange(p0, p_top - 1e-9, -dp)
    T, w, _, _ = th.parcel_profile(p, T0_k, Td0_k)
    return Profile(p, T, th.q_from_mixing_ratio(w), np.zeros_like(p), np.zeros_like(p))
