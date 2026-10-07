"""Milestone 2: observation tokens (03 s11, 01 s2.1, 02 s14).

Each token = variable id + source id + 8 numeric features. Rejected observations (quality <= 0) and
NaNs are not tokenised but are *counted* in the returned info; the raw store keeps them (02 s4).
"""
from __future__ import annotations
import heapq
from dataclasses import dataclass
from typing import Dict, List, Tuple
import numpy as np
from .normalizer import Normalizer, PROFILE_VARS, to_transformed

TOKEN_VARS = ("T", "q", "u", "v", "Z", "T2m", "q2m", "u10", "v10", "p_sfc", "gust", "rain")
SURFACE_TOKEN_VARS = frozenset(("T2m", "q2m", "u10", "v10", "p_sfc", "gust", "rain"))
SOURCES = ("radiosonde", "aws", "acars", "buoy", "other")
N_TOKEN_FEATS = 8   # value, log_sigma, quality, dx(100km), dy(100km), ln_p, is_surface, dt(12h)

# physical 1-sigma defaults; humidity values are RELATIVE errors
DEFAULT_UNC = {
    "radiosonde": {"T": 0.5, "q": 0.07, "u": 1.0, "v": 1.0, "Z": 10.0},
    "aws": {"T2m": 0.5, "q2m": 0.10, "u10": 1.0, "v10": 1.0, "p_sfc": 0.5, "gust": 2.0, "rain": 0.3},
    "acars": {"T": 0.8, "q": 0.15, "u": 1.5, "v": 1.5},
}


@dataclass
class RawObs:
    var: np.ndarray       # str
    value: np.ndarray     # physical units
    lat: np.ndarray
    lon: np.ndarray
    p_hpa: np.ndarray     # NaN for surface variables
    time_h: np.ndarray    # hours relative to t0 (negative = before)
    source: np.ndarray    # str
    quality: np.ndarray   # 0 (rejected) .. 1
    unc: np.ndarray       # physical 1-sigma; for q/q2m a RELATIVE error

    def __len__(self):
        return len(self.var)

    @staticmethod
    def concat(items: List["RawObs"]) -> "RawObs":
        items = [i for i in items if len(i)]
        if not items:
            return RawObs(*[np.array([]) for _ in range(9)])
        return RawObs(*[np.concatenate([getattr(i, f) for i in items]) for f in
                        ("var", "value", "lat", "lon", "p_hpa", "time_h", "source", "quality", "unc")])


def significant_levels(x, y, n_keep: int) -> np.ndarray:
    """Greedy Ramer-Douglas-Peucker thinning: keep the points that most reduce the linear-interpolation
    error, so inversions, jets and moisture steps survive thinning. x must be strictly increasing."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    n = len(x)
    if n <= n_keep:
        return np.arange(n)

    def worst(lo, hi):
        if hi - lo < 2:
            return 0.0, -1
        xs = x[lo + 1:hi]
        line = y[lo] + (y[hi] - y[lo]) * (xs - x[lo]) / (x[hi] - x[lo])
        err = np.abs(y[lo + 1:hi] - line)
        k = int(np.argmax(err))
        return float(err[k]), lo + 1 + k

    keep = {0, n - 1}
    e, k = worst(0, n - 1)
    heap: List[Tuple[float, int, int, int]] = [(-e, 0, n - 1, k)]
    while len(keep) < n_keep and heap:
        _, lo, hi, k = heapq.heappop(heap)
        if k < 0:
            continue
        keep.add(k)
        for a, b in ((lo, k), (k, hi)):
            e2, k2 = worst(a, b)
            heapq.heappush(heap, (-e2, a, b, k2))
    return np.array(sorted(keep))


def raw_from_sounding(norm: Normalizer, p, T, q, u, v, *, lat, lon, time_h=0.0, source="radiosonde",
                      n_sig=24, quality=1.0, z=None) -> RawObs:
    """Native-resolution sounding (index 0 = surface, p decreasing) -> thinned RawObs per variable."""
    p = np.asarray(p, float)
    cols = {"T": T, "q": q, "u": u, "v": v}
    if z is not None:
        cols["Z"] = z
    parts = []
    for var, vals in cols.items():
        vals = np.asarray(vals, float)
        m, s = norm.stats_at(var, p)
        yt = (to_transformed(var, vals) - m) / s
        idx = significant_levels(-np.log(p), yt, n_sig)
        unc = DEFAULT_UNC[source][var] * (vals[idx] if var == "q" else 1.0)
        n = len(idx)
        parts.append(RawObs(np.full(n, var), vals[idx], np.full(n, lat), np.full(n, lon), p[idx],
                            np.full(n, time_h), np.full(n, source), np.full(n, quality), np.asarray(unc, float) + 0 * vals[idx]))
    return RawObs.concat(parts)


def raw_surface(norm: Normalizer, values: Dict[str, float], *, lat, lon, time_h=0.0, source="aws", quality=1.0) -> RawObs:
    n = len(values)
    names = list(values)
    unc = [DEFAULT_UNC[source][k] * (values[k] if k == "q2m" else 1.0) for k in names]
    return RawObs(np.array(names), np.array([values[k] for k in names], float), np.full(n, lat), np.full(n, lon),
                  np.full(n, np.nan), np.full(n, time_h), np.full(n, source), np.full(n, quality), np.array(unc, float))


def encode_tokens(raw: RawObs, norm: Normalizer, *, lat0: float, lon0: float, max_tokens: int = 192):
    """RawObs -> padded fixed-size arrays. Returns (tokens dict, info dict)."""
    M = max_tokens
    out = {"tok_var": np.zeros(M, np.int64), "tok_src": np.zeros(M, np.int64),
           "tok_feat": np.zeros((M, N_TOKEN_FEATS), np.float32), "tok_mask": np.zeros(M, bool)}
    info = {"n_in": len(raw), "n_dropped_invalid": 0, "n_dropped_budget": 0}
    if len(raw) == 0:
        return out, info
    var_id = np.array([TOKEN_VARS.index(v) for v in raw.var])          # KeyError-style failure on unknown vars
    src_id = np.array([SOURCES.index(s) for s in raw.source])
    surf = np.array([v in SURFACE_TOKEN_VARS for v in raw.var])
    ok = (np.isfinite(raw.value) & np.isfinite(raw.unc) & (raw.quality > 0) & np.isfinite(raw.lat) & np.isfinite(raw.lon)
          & (surf | np.isfinite(raw.p_hpa)))
    info["n_dropped_invalid"] = int((~ok).sum())

    n = len(raw)
    val = np.zeros(n); sig = np.ones(n)
    for i in np.nonzero(ok)[0]:
        p = None if surf[i] else raw.p_hpa[i]
        val[i] = norm.encode_value(raw.var[i], raw.value[i], p)
        sig[i] = norm.encode_sigma(raw.var[i], raw.unc[i], raw.value[i], p)
    dx = (raw.lon - lon0) * 111.0 * np.cos(np.radians(lat0)) / 100.0
    dy = (raw.lat - lat0) * 111.0 / 100.0
    lnp = np.where(surf, 0.0, (np.log(np.where(surf, 1000.0, raw.p_hpa)) - 6.3) / 0.7)
    feat = np.stack([val, np.log(np.clip(sig, 1e-3, 20.0)), raw.quality, dx, dy, lnp, surf.astype(float), raw.time_h / 12.0], 1)

    score = raw.quality - 0.3 * np.hypot(dx, dy) * 100 / 500.0 - 0.2 * np.abs(raw.time_h) / 6.0 + 0.3 * (raw.source == "radiosonde")
    cand = np.nonzero(ok)[0]
    cand = cand[np.argsort(-score[cand], kind="stable")]
    info["n_dropped_budget"] = max(0, len(cand) - M)
    sel = cand[:M]
    k = len(sel)
    out["tok_var"][:k], out["tok_src"][:k] = var_id[sel], src_id[sel]
    out["tok_feat"][:k] = feat[sel].astype(np.float32)
    out["tok_mask"][:k] = True
    return out, info
