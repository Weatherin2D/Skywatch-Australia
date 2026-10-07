"""Thermodynamic primitives. Units: p [hPa], T [K], q [kg/kg], w [kg/kg].

Formulae follow Bolton (1980, MWR 108) for saturation vapour pressure, LCL and
theta-e. Moist ascent is pseudo-adiabatic (condensate removed instantly, liquid
water only; no ice phase), integrated with RK4.
"""
from __future__ import annotations
import math
import numpy as np
from .constants import (RD, CPD, KAPPA, EPS, T0, LV0, KAPPA_BOLTON)
KAPPA_EXPONENT = KAPPA


# ---------------------------------------------------------------- moisture
def sat_vapor_pressure(T):
    """Saturation vapour pressure over liquid water [hPa] (Bolton 1980)."""
    Tc = np.asarray(T, dtype=float) - T0
    return 6.112 * np.exp(17.67 * Tc / (Tc + 243.5))


def saturation_mixing_ratio(p, T):
    p = np.asarray(p, dtype=float)
    es = np.minimum(sat_vapor_pressure(T), 0.95 * p)
    return EPS * es / (p - es)


def mixing_ratio_from_q(q):
    q = np.asarray(q, dtype=float)
    return q / (1.0 - q)


def q_from_mixing_ratio(w):
    w = np.asarray(w, dtype=float)
    return w / (1.0 + w)


def vapor_pressure_from_mixing_ratio(p, w):
    return np.asarray(p, dtype=float) * np.asarray(w, dtype=float) / (EPS + np.asarray(w, dtype=float))


def dewpoint_from_vapor_pressure(e):
    e = np.maximum(np.asarray(e, dtype=float), 1e-8)
    x = np.log(e / 6.112)
    return T0 + 243.5 * x / (17.67 - x)


def dewpoint(p, q):
    """Dew point [K] from pressure and specific humidity."""
    return dewpoint_from_vapor_pressure(vapor_pressure_from_mixing_ratio(p, mixing_ratio_from_q(q)))


def relative_humidity(p, T, q):
    """RH as a fraction (0-1+) w.r.t. liquid water."""
    e = vapor_pressure_from_mixing_ratio(p, mixing_ratio_from_q(q))
    return e / sat_vapor_pressure(T)


def virtual_temperature(T, w):
    T = np.asarray(T, dtype=float)
    w = np.asarray(w, dtype=float)
    return T * (1.0 + w / EPS) / (1.0 + w)


def potential_temperature(p, T, p_ref=1000.0):
    return np.asarray(T, dtype=float) * (p_ref / np.asarray(p, dtype=float)) ** KAPPA


# --------------------------------------------------------------------- LCL
def lcl(p, T, Td):
    """Lifting condensation level. Returns (p_lcl [hPa], T_lcl [K]). Bolton eq. 15."""
    T = np.asarray(T, dtype=float)
    Td = np.minimum(np.asarray(Td, dtype=float), T)
    T_l = 1.0 / (1.0 / (Td - 56.0) + np.log(T / Td) / 800.0) + 56.0
    p_l = np.asarray(p, dtype=float) * (T_l / T) ** (1.0 / KAPPA)
    return p_l, T_l


def equivalent_potential_temperature(p, T, Td):
    """Bolton (1980) eq. 43 theta-e [K]; r in g/kg, T_L from eq. 15."""
    p = np.asarray(p, dtype=float)
    T = np.asarray(T, dtype=float)
    Td = np.minimum(np.asarray(Td, dtype=float), T)
    e = sat_vapor_pressure(Td)
    r = 1000.0 * EPS * e / (p - e)
    _, T_l = lcl(p, T, Td)
    return (T * (1000.0 / p) ** (KAPPA_BOLTON * (1.0 - 0.28e-3 * r))
            * np.exp((3.376 / T_l - 0.00254) * r * (1.0 + 0.81e-3 * r)))


def wet_bulb(p, T, w):
    """Isobaric wet-bulb temperature [K] by Newton iteration on
    cp (T - Tw) = Lv (rs(Tw) - w)."""
    p = np.asarray(p, dtype=float)
    T = np.asarray(T, dtype=float)
    w = np.asarray(w, dtype=float)
    Td = dewpoint_from_vapor_pressure(vapor_pressure_from_mixing_ratio(p, w))
    Td = np.minimum(Td, T)
    Tw = 0.5 * (T + Td)
    for _ in range(30):
        es = np.minimum(sat_vapor_pressure(Tw), 0.95 * p)
        rs = EPS * es / (p - es)
        lv = LV0 - 2370.0 * (Tw - T0)
        f = CPD * (T - Tw) - lv * (rs - w)
        dlnes = 17.67 * 243.5 / (Tw - T0 + 243.5) ** 2
        drs = rs * (p / (p - es)) * dlnes
        df = -CPD - lv * drs
        step = f / df
        Tw = Tw - step
        if np.all(np.abs(step) < 1e-6):
            break
    return np.clip(Tw, Td, T)


# ---------------------------------------------------------- parcel ascent
def _dTdp_moist(p: float, T: float) -> float:
    Tc = T - T0
    es = min(6.112 * math.exp(17.67 * Tc / (Tc + 243.5)), 0.95 * p)
    rs = EPS * es / (p - es)
    lv = LV0 - 2370.0 * Tc
    return (RD * T + lv * rs) / (p * (CPD + lv * lv * rs * EPS / (RD * T * T)))


def moist_ascent(p, T_start):
    """Pseudo-adiabatic temperature on pressure array `p` (decreasing), starting
    saturated at T_start at p[0]. RK4."""
    pl = np.asarray(p, dtype=float).tolist()
    out = [float(T_start)]
    T = float(T_start)
    f = _dTdp_moist
    for i in range(len(pl) - 1):
        p0 = pl[i]
        h = pl[i + 1] - p0
        k1 = f(p0, T)
        k2 = f(p0 + 0.5 * h, T + 0.5 * h * k1)
        k3 = f(p0 + 0.5 * h, T + 0.5 * h * k2)
        k4 = f(p0 + h, T + h * k3)
        T += h * (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0
        out.append(T)
    return np.asarray(out)


def parcel_profile(p_grid, T0_parcel, Td0_parcel):
    """Lift a parcel from p_grid[0]: dry adiabatic to the LCL, pseudo-adiabatic above.

    Returns (T_parcel, w_parcel, p_lcl, T_lcl) with T/w evaluated on p_grid."""
    p_grid = np.asarray(p_grid, dtype=float)
    p0 = p_grid[0]
    Td0_parcel = min(float(Td0_parcel), float(T0_parcel))
    e0 = float(sat_vapor_pressure(Td0_parcel))
    w0 = EPS * e0 / (p0 - e0)
    p_l, T_l = lcl(p0, T0_parcel, Td0_parcel)
    p_l, T_l = float(p_l), float(T_l)

    T = np.empty_like(p_grid)
    dry = p_grid >= p_l
    T[dry] = T0_parcel * (p_grid[dry] / p0) ** KAPPA
    wet = ~dry
    if wet.any():
        pts = np.concatenate([[p_l], p_grid[wet]])
        T[wet] = moist_ascent(pts, T_l)[1:]
    w = np.where(dry, w0, saturation_mixing_ratio(p_grid, T))
    return T, w, p_l, T_l
