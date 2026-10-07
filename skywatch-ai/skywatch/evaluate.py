"""V1 evaluation metrics (03 s25-26). Everything is computed through the deterministic engine, never by the net."""
from __future__ import annotations
from typing import Dict, Optional
import numpy as np
from .ensemble import run_engine, profile_from_normalized
from .normalizer import Normalizer
from . import thermo as th

# 03 s25 exit criteria. (direction: '<=' smaller is better, '>=' larger is better)
V1_TARGETS = {
    "T_rmse_K": ("<=", 1.2), "vector_wind_rmse_ms": ("<=", 2.5), "cape_corr": (">=", 0.90),
    "high_cape_mae": ("<=", 250.0), "inversion_hit_rate": (">=", 0.85), "artificial_cape_rate": ("<=", 0.05),
}


def inversion_strength(T, z_agl, max_height=1500.0):
    """Largest warming with height inside the lowest `max_height` m: (strength K, base height m)."""
    m = z_agl <= max_height
    Tm, zm = T[m], z_agl[m]
    runmin = np.minimum.accumulate(Tm)
    gain = Tm - runmin
    j = int(np.argmax(gain))
    i = int(np.nonzero(Tm[:j + 1] == runmin[j])[0][0])
    return float(gain[j]), float(zm[i])


def _llj_height(u, v, z_agl, max_height=3000.0):
    m = z_agl <= max_height
    return float(z_agl[m][np.argmax(np.hypot(u[m], v[m]))])


def _nanmean(x):
    x = np.asarray(x, float)
    return float(np.nanmean(x)) if np.isfinite(x).any() else float("nan")


def evaluate_batch(norm: Normalizer, pred_prof, pred_surf, truth_prof, truth_surf, valid, z_sfc,
                   pred_sigma=None, hemisphere: str = "S", inv_threshold: float = 1.5) -> Dict[str, float]:
    grid = norm.grid_p
    trop = (grid >= 200.0)[None, :] & valid
    P, Tr = norm.decode_profile(pred_prof), norm.decode_profile(truth_prof)
    m: Dict[str, float] = {}
    def rms(x, mask): return float(np.sqrt((x[mask] ** 2).mean()))
    m["T_rmse_K"] = rms(P[:, 0] - Tr[:, 0], trop)
    m["vector_wind_rmse_ms"] = float(np.sqrt((((P[:, 2] - Tr[:, 2]) ** 2 + (P[:, 3] - Tr[:, 3]) ** 2)[trop]).mean()))
    m["lnq_rmse"] = rms(P[:, 1] - Tr[:, 1], trop)
    m["Z_rmse_m"] = rms(P[:, 4] - Tr[:, 4], trop)
    low = (grid >= 500.0)[None, :] & valid
    td_p = th.dewpoint(grid[None, :], np.exp(P[:, 1])); td_t = th.dewpoint(grid[None, :], np.exp(Tr[:, 1]))
    m["dewpoint_bias_K"] = float((td_p - td_t)[low].mean())

    dp = run_engine(norm, pred_prof, pred_surf, z_sfc, hemisphere)
    dt = run_engine(norm, truth_prof, truth_surf, z_sfc, hemisphere)
    m["engine_fallback_rate"] = float(dp["_fallback"].mean()); m["engine_failure_rate"] = float(dp["_failed"].mean())
    ok = ~dp["_failed"] & ~dt["_failed"]
    cp, ct = dp["SBCAPE"][ok], dt["SBCAPE"][ok]
    m["cape_corr"] = float(np.corrcoef(cp, ct)[0, 1]) if ct.std() > 0 and cp.std() > 0 else float("nan")
    m["mucape_corr"] = float(np.corrcoef(dp["MUCAPE"][ok], dt["MUCAPE"][ok])[0, 1]) if dt["MUCAPE"][ok].std() > 0 else float("nan")
    hi = ct > 2000.0
    m["high_cape_n"] = float(hi.sum())
    m["high_cape_mae"] = float(np.abs(cp[hi] - ct[hi]).mean()) if hi.any() else float("nan")
    stable = (ct < 1.0) & (dt["MLCAPE"][ok] < 1.0)
    m["stable_n"] = float(stable.sum())
    m["artificial_cape_rate"] = float((cp[stable] > 100.0).mean()) if stable.any() else float("nan")
    for k in ("shear_0_6km", "srh_0_3km", "PWAT", "SB_LCL", "freezing_level", "wet_bulb_zero"):
        m[f"mae_{k}"] = _nanmean(np.abs(dp[k][ok] - dt[k][ok]))

    # structure: inversions and low-level jets, from the Profile objects the engine actually sees
    hits = fas = n_inv = n_noinv = 0
    base_err, llj_err = [], []
    for b in range(len(pred_prof)):
        try:
            pp, _ = profile_from_normalized(norm, pred_prof[b], pred_surf[b], z_sfc[b])
            tp, _ = profile_from_normalized(norm, truth_prof[b], truth_surf[b], z_sfc[b])
        except ValueError:
            continue
        sp, bp = inversion_strength(pp.T, pp.z_agl); st, bt = inversion_strength(tp.T, tp.z_agl)
        if st >= inv_threshold:
            n_inv += 1; hits += sp >= inv_threshold
            if sp >= inv_threshold: base_err.append(abs(bp - bt))
        else:
            n_noinv += 1; fas += sp >= inv_threshold
        llj_err.append(abs(_llj_height(pp.u, pp.v, pp.z_agl) - _llj_height(tp.u, tp.v, tp.z_agl)))
    m["inversion_n"] = float(n_inv)
    m["inversion_hit_rate"] = hits / n_inv if n_inv else float("nan")
    m["inversion_false_alarm_rate"] = fas / n_noinv if n_noinv else float("nan")
    m["inversion_base_mae_m"] = _nanmean(base_err)
    m["llj_height_mae_m"] = _nanmean(llj_err)

    if pred_sigma is not None:                                                      # calibration (normalised space)
        z = (truth_prof - pred_prof) / pred_sigma
        zm = np.broadcast_to(valid[:, None, :], z.shape)
        m["coverage_80"] = float((np.abs(z[zm]) <= 1.2816).mean())
        m["spread_skill_z2"] = float((z[zm] ** 2).mean())
    return m


def check_targets(metrics: Dict[str, float]) -> Dict[str, dict]:
    out = {}
    for k, (op, tgt) in V1_TARGETS.items():
        v = metrics.get(k, float("nan"))
        ok = (v <= tgt) if op == "<=" else (v >= tgt)
        out[k] = dict(value=v, target=tgt, op=op, passed=bool(ok) if np.isfinite(v) else False)
    return out
