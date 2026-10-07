"""Deterministic meteorological diagnostics engine (03_V1_SOUNDING_MODEL s22-23).

Pure functions of a Profile: no randomness, no neural network, no global state.

Conventions (document any change in the dataset/model card)
-----------------------------------------------------------
* CAPE >= 0 [J/kg]. CIN <= 0 [J/kg] (integral of negative buoyancy from the
  parcel origin to the LFC). LFC/EL/CAPE describe the *principal buoyant layer*: the
  contiguous positive-buoyancy layer above the LCL with the largest CAPE (layers below
  0.5 J/kg are ignored). If there is none, CAPE = 0 and CIN is integrated up to
  `cin_ceiling_hpa`. Freezing level / wet-bulb zero are evaluated on the fine grid.
* Buoyancy uses virtual temperature (parcel moisture and environment moisture).
* Heights (LCL/LFC/EL/freezing level/...) are metres above ground (index 0).
* Lifted parcels: SB = surface parcel; ML = lowest-100-hPa mean theta & mixing
  ratio lifted from the surface pressure; MU = max theta-e parcel in lowest 300 hPa.
* Storm motion: Bunkers et al. (2000) internal-dynamics method. SRH is signed so
  that POSITIVE = favourable for cyclonic supercells *in the given hemisphere*:
    - 'N': right-mover motion, SRH as usually defined
    - 'S': left-mover motion with sign flipped (exact mirror image of 'N')
  Layers needing 6 km of data (storm motion) return NaN if the profile top is
  below 6 km AGL.
* Not yet implemented: effective-layer SRH/shear, STP/SCP composites, ice-phase
  moist ascent.
"""
from __future__ import annotations
import math
from typing import Dict, List
import numpy as np

from .constants import RD, G, KAPPA, T0
from .profile import Profile
from . import thermo as th

NAN = float("nan")
_trapz = getattr(np, "trapezoid", None) or np.trapz


# ---------------------------------------------------------------- helpers
class _Env:
    """Environment interpolated linearly in ln(p)."""

    def __init__(self, prof: Profile):
        self.prof = prof
        self.x = -np.log(prof.p)                     # increasing
        self.w = th.mixing_ratio_from_q(prof.q)

    def at(self, arr, p):
        return np.interp(-np.log(p), self.x, arr)


def _grid(p_start: float, p_top: float, dp: float) -> np.ndarray:
    g = np.arange(p_start, p_top, -dp)
    if g.size == 0 or g[-1] > p_top + 1e-9:
        g = np.append(g, p_top)
    return g


def _first_crossing(z, val, level):
    """Height where `val` first falls to <= level going upward (0 if already at/below)."""
    if val[0] <= level:
        return 0.0
    idx = np.nonzero(val <= level)[0]
    if idx.size == 0:
        return NAN
    i = idx[0]
    t = (val[i - 1] - level) / (val[i - 1] - val[i])
    return float(z[i - 1] + t * (z[i] - z[i - 1]))


# ---------------------------------------------------------- parcel / CAPE
def _parcel_analysis(env: _Env, p_start, T_start, Td_start, dp, cin_ceiling, virtual=True, cape_floor=0.5):
    prof = env.prof
    p_top = prof.p[-1]
    res = dict(cape=0.0, cin=0.0, lcl_p=NAN, lcl_z=NAN, lfc_p=NAN, lfc_z=NAN, el_p=NAN, el_z=NAN)
    if p_start - p_top < 3 * dp:
        return res
    grid = _grid(p_start, p_top, dp)
    Te, we = env.at(prof.T, grid), env.at(env.w, grid)
    Tp, wp, p_l, _ = th.parcel_profile(grid, T_start, Td_start)
    if virtual:
        B = th.virtual_temperature(Tp, wp) - th.virtual_temperature(Te, we)
    else:
        B = Tp - Te
    lnp = np.log(grid)
    x = -lnp
    res["lcl_p"] = p_l
    if p_l >= p_top:
        res["lcl_z"] = float(env.at(prof.z_agl, p_l))

    # --- principal buoyant layer: the contiguous B > 0 layer above the LCL with the largest CAPE.
    #     (Taking the *first* layer lets a paper-thin sliver above the LCL hide a deep layer above a cap.)
    lfc_p = el_p = NAN
    best = 0.0
    above = np.nonzero(grid <= p_l)[0]
    if above.size:
        i0 = int(above[0])
        pos = (B[i0:] > 0).astype(np.int8)
        edges = np.diff(np.concatenate([[0], pos, [0]]))
        for a_, b_ in zip(np.nonzero(edges == 1)[0] + i0, np.nonzero(edges == -1)[0] - 1 + i0):
            if a_ == i0:
                lp = p_l
            else:
                t = -B[a_ - 1] / (B[a_] - B[a_ - 1])
                lp = float(math.exp(lnp[a_ - 1] + t * (lnp[a_] - lnp[a_ - 1])))
            if b_ == len(grid) - 1:
                ep = float(p_top)
            else:
                t = B[b_] / (B[b_] - B[b_ + 1])
                ep = float(math.exp(lnp[b_] + t * (lnp[b_ + 1] - lnp[b_])))
            pts = np.concatenate([[lp], grid[(grid < lp) & (grid > ep)], [ep]])
            Bp = np.interp(-np.log(pts), x, B)
            c = float(RD * _trapz(np.maximum(Bp, 0.0), -np.log(pts)))
            if c > best:
                best, lfc_p, el_p = c, lp, ep
    if best >= cape_floor:
        res.update(cape=best, lfc_p=lfc_p, lfc_z=float(env.at(prof.z_agl, lfc_p)),
                   el_p=el_p, el_z=float(env.at(prof.z_agl, el_p)))
    else:
        lfc_p = NAN

    # --- CIN (<= 0)
    p_end = lfc_p if np.isfinite(lfc_p) else max(cin_ceiling, p_top)
    pts = np.concatenate([grid[grid > p_end], [p_end]])
    Bp = np.minimum(np.interp(-np.log(pts), x, B), 0.0)
    res["cin"] = float(RD * _trapz(Bp, -np.log(pts))) if pts.size > 1 else 0.0
    return res


def _ml_start(env: _Env, depth=100.0, dp=1.0):
    prof = env.prof
    p0 = prof.p[0]
    g = _grid(p0, max(p0 - depth, prof.p[-1]), dp)
    T, w = env.at(prof.T, g), env.at(env.w, g)
    theta_m = float(np.mean(th.potential_temperature(g, T)))
    w_m = float(np.mean(w))
    T_s = theta_m * (p0 / 1000.0) ** KAPPA
    Td_s = float(th.dewpoint_from_vapor_pressure(th.vapor_pressure_from_mixing_ratio(p0, w_m)))
    return p0, T_s, Td_s


def _mu_start(env: _Env, depth=300.0, dp=5.0):
    prof = env.prof
    p0 = prof.p[0]
    g = _grid(p0, max(p0 - depth, prof.p[-1]), dp)
    T, w = env.at(prof.T, g), env.at(env.w, g)
    Td = np.minimum(th.dewpoint_from_vapor_pressure(th.vapor_pressure_from_mixing_ratio(g, w)), T)
    k = int(np.argmax(th.equivalent_potential_temperature(g, T, Td)))
    return float(g[k]), float(T[k]), float(Td[k])


# ------------------------------------------------------------------ winds
def _wind_block(prof: Profile, hemisphere: str, dz=50.0) -> Dict[str, float]:
    z, u, v = prof.z_agl, prof.u, prof.v
    top = z[-1]
    out = {k: NAN for k in (
        "shear_0_1km", "shear_0_3km", "shear_0_6km", "veering_0_3km_deg",
        "srh_0_1km", "srh_0_3km", "storm_motion_u", "storm_motion_v",
        "sr_wind_0_2km", "sr_wind_4_6km", "mean_wind_0_6km")}

    def uv(h):
        return float(np.interp(h, z, u)), float(np.interp(h, z, v))

    for h, name in ((1000, "shear_0_1km"), (3000, "shear_0_3km"), (6000, "shear_0_6km")):
        if top >= h:
            uh, vh = uv(h)
            out[name] = math.hypot(uh - u[0], vh - v[0])

    if top >= 3000:
        u3, v3 = uv(3000)
        if math.hypot(u[0], v[0]) >= 0.5 and math.hypot(u3, v3) >= 0.5:
            d0 = (270.0 - math.degrees(math.atan2(v[0], u[0]))) % 360.0
            d3 = (270.0 - math.degrees(math.atan2(v3, u3))) % 360.0
            out["veering_0_3km_deg"] = ((d3 - d0 + 180.0) % 360.0) - 180.0   # +ve = clockwise (veering)

    if top < 6000:
        return out
    zg = np.arange(0.0, 6000.0 + 1e-9, dz)
    ug, vg = np.interp(zg, z, u), np.interp(zg, z, v)
    mu, mv = ug.mean(), vg.mean()
    lo, hi = zg <= 500.0, zg >= 5500.0
    sx, sy = ug[hi].mean() - ug[lo].mean(), vg[hi].mean() - vg[lo].mean()
    mag = math.hypot(sx, sy)
    dx, dy = (7.5 * sy / mag, -7.5 * sx / mag) if mag > 1e-9 else (0.0, 0.0)   # 7.5 m/s to the right of shear
    if hemisphere.upper() == "N":
        cx, cy, sign = mu + dx, mv + dy, 1.0
    elif hemisphere.upper() == "S":
        cx, cy, sign = mu - dx, mv - dy, -1.0
    else:
        raise ValueError("hemisphere must be 'N' or 'S'")
    out.update(storm_motion_u=float(cx), storm_motion_v=float(cy), mean_wind_0_6km=float(math.hypot(mu, mv)))

    def srh(top_m):
        m = zg <= top_m + 1e-9
        a, b = ug[m], vg[m]
        return float(sign * np.sum((a[1:] - cx) * (b[:-1] - cy) - (a[:-1] - cx) * (b[1:] - cy)))

    out["srh_0_1km"], out["srh_0_3km"] = srh(1000.0), srh(3000.0)
    for name, m in (("sr_wind_0_2km", zg <= 2000.0), ("sr_wind_4_6km", zg >= 4000.0)):
        out[name] = float(math.hypot(ug[m].mean() - cx, vg[m].mean() - cy))
    return out


# --------------------------------------------------------------- top level
def compute_diagnostics(prof: Profile, hemisphere: str = "S", dp: float = 1.0,
                        cin_ceiling_hpa: float = 500.0, virtual: bool = True) -> Dict[str, float]:
    """All V1 diagnostics for one column. Deterministic; same input -> same output."""
    env = _Env(prof)
    p0 = prof.p[0]
    out: Dict[str, float] = {}

    starts = {
        "SB": (p0, float(prof.T[0]), float(th.dewpoint(p0, prof.q[0]))),
        "ML": _ml_start(env),
        "MU": _mu_start(env),
    }
    for tag, (ps, Ts, Tds) in starts.items():
        r = _parcel_analysis(env, ps, Ts, min(Tds, Ts), dp, cin_ceiling_hpa, virtual=virtual)
        out[f"{tag}CAPE"], out[f"{tag}CIN"] = r["cape"], r["cin"]
        out[f"{tag}_LCL"], out[f"{tag}_LFC"], out[f"{tag}_EL"] = r["lcl_z"], r["lfc_z"], r["el_z"]
        out[f"{tag}_LCL_hpa"], out[f"{tag}_LFC_hpa"], out[f"{tag}_EL_hpa"] = r["lcl_p"], r["lfc_p"], r["el_p"]
    # 03 s37 schema aliases = surface-based parcel
    out.update(CIN=out["SBCIN"], LCL=out["SB_LCL"], LFC=out["SB_LFC"], EL=out["SB_EL"])

    # precipitable water [mm]
    g = _grid(p0, prof.p[-1], dp)
    qg = env.at(prof.q, g)
    out["PWAT"] = float(np.sum(0.5 * (qg[:-1] + qg[1:]) * (g[:-1] - g[1:])) * 100.0 / G)

    out.update(_wind_block(prof, hemisphere))

    # lapse rates [K/km, positive = temperature decreasing with height]
    z, T = prof.z_agl, prof.T
    def lapse(z1, z2):
        if z[-1] < z2:
            return NAN
        return -(float(np.interp(z2, z, T)) - float(np.interp(z1, z, T))) / ((z2 - z1) / 1000.0)
    out["lapse_0_3km"], out["lapse_3_6km"] = lapse(0, 3000), lapse(3000, 6000)
    if p0 >= 700.0 and prof.p[-1] <= 500.0:
        T7, T5 = float(env.at(T, 700.0)), float(env.at(T, 500.0))
        z7, z5 = float(env.at(z, 700.0)), float(env.at(z, 500.0))
        out["lapse_700_500"] = -(T5 - T7) / ((z5 - z7) / 1000.0)
    else:
        out["lapse_700_500"] = NAN

    zf, Tf, wf = env.at(z, g), env.at(T, g), env.at(env.w, g)      # fine grid: resolution-independent
    out["freezing_level"] = _first_crossing(zf, Tf, T0)
    out["wet_bulb_zero"] = _first_crossing(zf, th.wet_bulb(g, Tf, wf), T0)
    return out


def compute_batch(p, T, q, u, v, z=None, hemisphere: str = "S", **kw) -> Dict[str, np.ndarray]:
    """Run the engine over a batch/ensemble. T,q,u,v,(z): (B, N); p: (N,) or (B, N).
    Every column must start at the surface (index 0) with pressure decreasing."""
    T = np.asarray(T)
    p = np.asarray(p)
    rows: List[Dict[str, float]] = []
    for b in range(T.shape[0]):
        pb = p if p.ndim == 1 else p[b]
        zb = None if z is None else np.asarray(z)[b]
        rows.append(compute_diagnostics(Profile(pb, T[b], np.asarray(q)[b], np.asarray(u)[b], np.asarray(v)[b], zb),
                                        hemisphere=hemisphere, **kw))
    return {k: np.array([r[k] for r in rows]) for k in rows[0]}
