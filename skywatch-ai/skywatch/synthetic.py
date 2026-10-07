"""Synthetic atmosphere: random physically-structured columns, simulated teacher/observations, and a
dataset in the sample format defined by `contract.py`.

SYNTHETIC DATA ONLY validates code paths and basic learnability. It says nothing about real skill.
"""
from __future__ import annotations
from typing import Dict, List
import numpy as np
from scipy.ndimage import gaussian_filter1d

from .constants import G, RD, EPS
from .grid import make_vertical_grid, interp_lnp, level_index, valid_levels, fill_below_ground
from .normalizer import Normalizer, PROFILE_VARS, SURFACE_VARS, to_transformed
from .obs_tokens import raw_from_sounding, raw_surface, encode_tokens, RawObs, DEFAULT_UNC
from .profile import Profile
from . import thermo as th

IN_LEVELS = np.array([1000., 950., 900., 850., 800., 700., 600., 500., 400., 300., 250., 200., 150., 100.])
N_FIELD_CHANNELS = len(PROFILE_VARS) * len(IN_LEVELS) + 4      # + T2m, q2m, u10, v10
N_STATIC = 8
N_HIST = 3
WINDOW = 9


# ------------------------------------------------------------------ random columns
def random_column(rng: np.random.Generator, dz: float = 100.0, ztop: float = 17000.0,
                  force_inversion=None, force_elevated=False) -> Dict[str, np.ndarray]:
    """Analytic column on a height grid (AGL) with optional inversion, moist/dry layers, LLJ, deep shear."""
    z = np.arange(0.0, ztop + dz, dz)
    p_sfc = rng.uniform(820, 975) if (force_elevated or rng.random() < 0.12) else rng.uniform(975, 1025)
    T_sfc = rng.uniform(262, 306)
    z_tp = rng.uniform(10000, 15500)
    gam = rng.uniform(5.0, 9.0) / 1000.0
    noise = gaussian_filter1d(rng.normal(0, 1, z.size), 6) * 4.0 * rng.uniform(0.0, 1.5) / 1000.0
    lapse = np.where(z < z_tp, gam + noise, -rng.uniform(0.0, 2.0) / 1000.0)
    lapse = gaussian_filter1d(lapse, 2)
    T = T_sfc - np.concatenate([[0.0], np.cumsum(0.5 * (lapse[1:] + lapse[:-1]) * dz)])
    has_inv = (rng.random() < 0.5) if force_inversion is None else force_inversion
    if has_inv:
        zi, th_ = rng.uniform(0, 1500), rng.uniform(100, 500)
        T = T + rng.uniform(1.2, 8.0) * np.clip((z - zi) / th_, 0, 1)
    T = np.maximum(T, 190.0)

    rh = rng.uniform(0.35, 1.0) * np.exp(-z / rng.uniform(1500, 4500))
    if rng.random() < 0.4:
        rh = rh + rng.uniform(0.2, 0.5) * np.exp(-0.5 * ((z - rng.uniform(500, 4000)) / 300.0) ** 2)
    if rng.random() < 0.3:
        rh = rh - rng.uniform(0.2, 0.5) * np.exp(-0.5 * ((z - rng.uniform(1500, 4500)) / 500.0) ** 2)
    rh = np.where(z > z_tp, 0.05, np.clip(rh, 0.02, 1.0))

    p = p_sfc * np.exp(-z / 8000.0)
    for _ in range(3):                                     # hydrostatic pressure with virtual temperature
        es = th.sat_vapor_pressure(T)
        e = rh * es
        w = EPS * e / (p - e)
        Tv = th.virtual_temperature(T, w)
        p = p_sfc * np.exp(-np.concatenate([[0.0], np.cumsum(G * dz / (RD * 0.5 * (Tv[1:] + Tv[:-1])))]))
    es = th.sat_vapor_pressure(T)
    e = np.minimum(rh * es, 0.95 * p)
    q = th.q_from_mixing_ratio(EPS * e / (p - e))

    u0, v0 = rng.normal(0, 3.0, 2)
    S, th0, turn = rng.uniform(5, 35), rng.uniform(0, 2 * np.pi), np.radians(rng.uniform(-80, 80))
    f = np.clip(z / 6000.0, 0, 1) + 0.4 * np.exp(-0.5 * ((z - rng.uniform(9000, 12000)) / 2500.0) ** 2) * (z > 6000)
    ang = th0 + turn * np.clip(z / 6000.0, 0, 1)
    u, v = u0 + S * f * np.cos(ang), v0 + S * f * np.sin(ang)
    if rng.random() < 0.4:
        A, zj, wj, psi = rng.uniform(5, 14), rng.uniform(300, 1500), rng.uniform(150, 400), rng.uniform(0, 2 * np.pi)
        jet = A * np.exp(-0.5 * ((z - zj) / wj) ** 2)
        u, v = u + jet * np.cos(psi), v + jet * np.sin(psi)
    return dict(z=z, p=p, T=T, q=q, u=u, v=v, p_sfc=float(p_sfc), z_tp=z_tp, has_inversion=bool(has_inv))


def column_profile(col, with_z=True) -> Profile:
    return Profile(col["p"], col["T"], col["q"], col["u"], col["v"], z=col["z"] if with_z else None)


def column_on_grid(col, grid_p, z_sfc=0.0):
    """-> (5,N) transformed-space profile [T, ln q, u, v, Z] and valid mask. Below-ground levels are filled by
    clamping (they are masked everywhere downstream)."""
    prof = np.stack([interp_lnp(grid_p, col["p"], col["T"]),
                     interp_lnp(grid_p, col["p"], np.log(np.maximum(col["q"], 1e-6))),
                     interp_lnp(grid_p, col["p"], col["u"]), interp_lnp(grid_p, col["p"], col["v"]),
                     z_sfc + interp_lnp(grid_p, col["p"], col["z"])])
    return prof, valid_levels(grid_p, col["p_sfc"])


def surface_vector(col, z_sfc=0.0):
    return np.array([col["T"][0], np.log(max(col["q"][0], 1e-6)), col["u"][0], col["v"][0], col["p_sfc"]])


# ------------------------------------------------------------------ simulated teacher / observations
def _smooth_levels(prof, rng):
    out = prof.copy()
    for i in range(4):
        out[i] = gaussian_filter1d(prof[i], rng.uniform(1.5, 3.5), mode="nearest")
    return out


def make_sample(rng: np.random.Generator, grid_p, norm: Normalizer, max_tokens=128, n_sig=16) -> Dict[str, np.ndarray]:
    N = len(grid_p)
    col = random_column(rng)
    z_sfc = float(44330.77 * (1 - (col["p_sfc"] / 1013.25) ** 0.190263))
    truth, valid = column_on_grid(col, grid_p, z_sfc)
    truth_s = surface_vector(col)

    # teacher: vertically smoothed (inversions/jets blurred) + smooth biases
    bl = np.exp(-(1050.0 - grid_p) / 250.0)
    teacher = _smooth_levels(truth, rng)
    teacher[0] += rng.normal(0, 0.7) * bl
    teacher[1] += rng.normal(0, 0.12)
    teacher[2] += rng.normal(0, 0.8); teacher[3] += rng.normal(0, 0.8)
    teacher_s = truth_s + rng.normal(0, 1.0, 5) * np.array([0.8, 0.10, 0.8, 0.8, 1.0])
    nearest = teacher + gaussian_filter1d(rng.normal(0, 1, (5, N)), 2, axis=1) * (0.15 * norm.p_std)
    persist = truth + gaussian_filter1d(rng.normal(0, 1, (5, N)), 3, axis=1) * (0.5 * norm.p_std)
    persist_s = truth_s + rng.normal(0, 1, 5) * 0.5 * norm.s_std

    # observations (inputs): independent noise realisation #1; held-out loss targets: realisation #2
    lat0, lon0 = rng.uniform(-40, -12), rng.uniform(115, 153)
    raws: List[RawObs] = []
    obs_t = np.zeros((5, N)); obs_m = np.zeros((5, N), bool); obs_s = np.ones((5, N))
    zero_sfc = np.zeros(5)
    if rng.random() < 0.6:                                              # radiosonde at the target
        rs = DEFAULT_UNC["radiosonde"]
        def noisy(c, k):
            return dict(T=c["T"] + rng.normal(0, rs["T"], c["T"].size),
                        q=c["q"] * np.exp(rng.normal(0, rs["q"], c["q"].size)),
                        u=c["u"] + rng.normal(0, rs["u"], c["u"].size), v=c["v"] + rng.normal(0, rs["v"], c["v"].size))
        a = noisy(col, 1)
        raws.append(raw_from_sounding(norm, col["p"], a["T"], a["q"], a["u"], a["v"], lat=lat0, lon=lon0,
                                      time_h=-0.5, n_sig=n_sig))
        b = noisy(col, 2)                                                # held-out dense obs interpolated to grid
        for i, var in enumerate(("T", "q", "u", "v")):
            vals = to_transformed(var, b[var])
            obs_t[i] = interp_lnp(grid_p, col["p"], norm.encode_value(var, b[var], col["p"]))
            sig = norm.encode_sigma(var, rs[var] * (b[var] if var == "q" else 1.0), b[var], col["p"])
            obs_s[i] = interp_lnp(grid_p, col["p"], sig)
            obs_m[i] = valid & (grid_p >= col["p"][-1])
    surf_t, surf_m, surf_s = np.zeros(5), np.zeros(5, bool), np.ones(5)
    if rng.random() < 0.9:                                              # AWS near the target
        au = DEFAULT_UNC["aws"]
        def aws(k):
            return {"T2m": truth_s[0] + rng.normal(0, au["T2m"]), "q2m": np.exp(truth_s[1] + rng.normal(0, au["q2m"])),
                    "u10": truth_s[2] + rng.normal(0, au["u10"]), "v10": truth_s[3] + rng.normal(0, au["v10"]),
                    "p_sfc": truth_s[4] + rng.normal(0, au["p_sfc"])}
        raws.append(raw_surface(norm, aws(1), lat=lat0 + rng.normal(0, 0.1), lon=lon0 + rng.normal(0, 0.1), time_h=-0.1))
        held = aws(2)
        for i, var in enumerate(SURFACE_VARS):
            surf_t[i] = norm.encode_value(var, held[var]); surf_m[i] = True
            surf_s[i] = norm.encode_sigma(var, au[var] * (held[var] if var == "q2m" else 1.0), held[var])
    if rng.random() < 0.4:                                              # a few ACARS reports
        k = rng.integers(3, 8)
        ps = np.sort(rng.uniform(250, col["p_sfc"] - 50, k))[::-1]
        au = DEFAULT_UNC["acars"]
        Tq, uq, vq = (interp_lnp(ps, col["p"], col[n]) for n in ("T", "u", "v"))
        raws.append(RawObs.concat([
            RawObs(np.full(k, "T"), Tq + rng.normal(0, au["T"], k), np.full(k, lat0 + .5), np.full(k, lon0 + .5), ps, np.full(k, -0.7), np.full(k, "acars"), np.full(k, 0.8), np.full(k, au["T"])),
            RawObs(np.full(k, "u"), uq + rng.normal(0, au["u"], k), np.full(k, lat0 + .5), np.full(k, lon0 + .5), ps, np.full(k, -0.7), np.full(k, "acars"), np.full(k, 0.8), np.full(k, au["u"])),
            RawObs(np.full(k, "v"), vq + rng.normal(0, au["v"], k), np.full(k, lat0 + .5), np.full(k, lon0 + .5), ps, np.full(k, -0.7), np.full(k, "acars"), np.full(k, 0.8), np.full(k, au["v"]))]))
    toks, _ = encode_tokens(RawObs.concat(raws), norm, lat0=lat0, lon0=lon0, max_tokens=max_tokens)

    # gridded input window: teacher fields at IN_LEVELS + surface, with smooth spatial structure
    idx = level_index(grid_p, IN_LEVELS)
    H = W = WINDOW
    xs, ys = np.meshgrid(np.linspace(-1, 1, W), np.linspace(-1, 1, H))
    fields = np.zeros((N_HIST, N_FIELD_CHANNELS, H, W), np.float32)
    fb = lambda x: fill_below_ground(x, valid)
    tn, tsn = fb(norm.encode_profile(teacher)), norm.encode_surface(teacher_s)
    drift = gaussian_filter1d(rng.normal(0, 1, (5, N)), 3, axis=1) * 0.2
    for t in range(N_HIST):
        prof_t = tn + (t - (N_HIST - 1)) * drift
        base = np.concatenate([prof_t[:, idx].reshape(-1), tsn[:4]])
        a, b = rng.normal(0, 0.3, 2)
        fields[t] = base[:, None, None] + (a * xs + b * ys)[None] * 0.3 + rng.normal(0, 0.05, (len(base), H, W))
    sf = np.zeros((N_STATIC, H, W), np.float32)
    sf[0] = z_sfc / 1000.0 + 0.05 * xs; sf[1] = abs(0.05 * ys); sf[2] = np.sin(rng.uniform(0, 6.28)); sf[3] = np.cos(rng.uniform(0, 6.28))
    sf[4] = rng.uniform(0, 5); sf[5] = float(rng.random() < 0.9); sf[6] = (lat0 + 25) / 15.0 + 0.01 * ys; sf[7] = (lon0 - 134) / 20.0 + 0.01 * xs

    is_event = bool(col["has_inversion"] or np.hypot(col["u"][60] - col["u"][0], col["v"][60] - col["v"][0]) > 25)
    f32 = lambda a: np.asarray(a, np.float32)
    return dict(fields=fields, static=sf, **toks,
                teacher_profile=f32(tn), teacher_surface=f32(tsn), teacher_nearest=f32(fb(norm.encode_profile(nearest))),
                persistence_profile=f32(fb(norm.encode_profile(persist))), persistence_surface=f32(norm.encode_surface(persist_s)),
                persistence_valid=np.bool_(rng.random() < 0.5),
                p_sfc_prior=np.float32(teacher_s[4]), z_sfc=np.float32(z_sfc), valid=valid,
                target_profile=f32(fb(norm.encode_profile(truth))), target_surface=f32(norm.encode_surface(truth_s)),
                obs_target=f32(obs_t), obs_mask=obs_m, obs_sigma=f32(obs_s),
                surf_obs_target=f32(surf_t), surf_obs_mask=surf_m, surf_obs_sigma=f32(surf_s),
                event_weight=np.float32(3.0 if is_event else 1.0))


def make_dataset(n: int, seed: int = 0, grid_p=None, norm: Normalizer = None, **kw) -> List[Dict[str, np.ndarray]]:
    grid_p = make_vertical_grid() if grid_p is None else grid_p
    norm = Normalizer.default(grid_p) if norm is None else norm
    rng = np.random.default_rng(seed)
    return [make_sample(rng, grid_p, norm, **kw) for _ in range(n)]


def stack(samples: List[Dict[str, np.ndarray]]) -> Dict[str, np.ndarray]:
    return {k: np.stack([s[k] for s in samples]) for k in samples[0]}
