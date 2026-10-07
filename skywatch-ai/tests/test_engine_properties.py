"""Stress tests for the diagnostics engine on randomised, physically-structured columns."""
import sys, os, unittest, math
import numpy as np
from scipy.integrate import solve_ivp
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from skywatch import Profile, compute_diagnostics
from skywatch.constants import G, KAPPA
from skywatch.synthetic import random_column, column_profile
from skywatch import thermo as th

N_COL = 250
COLS = [random_column(np.random.default_rng(1000 + i)) for i in range(N_COL)]
DIAG = [compute_diagnostics(column_profile(c)) for c in COLS]


def same(a, b, tol, msg=""):
    for k in a:
        x, y = a[k], b[k]
        if math.isnan(x) and math.isnan(y):
            continue
        assert abs(x - y) <= tol * max(1.0, abs(x)), f"{msg} {k}: {x} vs {y}"


class TestInvariants(unittest.TestCase):
    def test_regression_thin_sliver_must_not_hide_capped_deep_layer(self):
        """Warming the surface parcel creates a sliver of positive buoyancy just above the LCL, then a cap,
        then deep convection. The old first-layer logic reported CAPE ~0 and CIN 0 (cap invisible)."""
        c = COLS[216]
        T = c["T"].copy(); T[0] += 2.0
        before, after = DIAG[216], compute_diagnostics(column_profile(dict(c, T=T)))
        self.assertGreater(before["SBCAPE"], 1000.0)
        self.assertGreaterEqual(after["SBCAPE"], before["SBCAPE"])
        self.assertLess(after["SBCIN"], -20.0)                       # the cap is still reported
        self.assertGreater(after["SB_LFC"], after["SB_LCL"] + 200.0)  # LFC is the deep layer's, not the sliver's

    def test_signs_ordering_and_finiteness(self):
        for c, d in zip(COLS, DIAG):
            for tag in ("SB", "ML", "MU"):
                cape, cin = d[f"{tag}CAPE"], d[f"{tag}CIN"]
                self.assertTrue(np.isfinite(cape) and np.isfinite(cin))
                self.assertGreaterEqual(cape, 0.0)
                self.assertLessEqual(cin, 1e-9)
                lcl, lfc, el = d[f"{tag}_LCL"], d[f"{tag}_LFC"], d[f"{tag}_EL"]
                if cape > 0:
                    self.assertTrue(lcl <= lfc + 1e-6 and lfc < el, (tag, lcl, lfc, el))
                else:
                    self.assertTrue(math.isnan(lfc) and math.isnan(el))
            self.assertTrue(0.0 <= d["PWAT"] < 120.0)
            self.assertTrue(d["shear_0_6km"] >= 0)

    def test_mucape_not_systematically_below_mlcape(self):
        bad = sum(d["MUCAPE"] < d["MLCAPE"] - 25 for d in DIAG)
        self.assertLess(bad / N_COL, 0.05)

    def test_corpus_has_useful_variety(self):
        capes = np.array([d["SBCAPE"] for d in DIAG])
        self.assertGreater((capes > 500).sum(), 15)
        self.assertGreater((capes == 0).sum(), 15)
        self.assertGreater(max(capes), 2000)

    def test_galilean_and_rotation_invariance(self):
        rng = np.random.default_rng(1)
        keys = ("shear_0_1km", "shear_0_3km", "shear_0_6km", "srh_0_1km", "srh_0_3km", "sr_wind_0_2km", "sr_wind_4_6km")
        for c in COLS[:60]:
            base = compute_diagnostics(column_profile(c))
            a = rng.uniform(-20, 20, 2)
            shifted = dict(c, u=c["u"] + a[0], v=c["v"] + a[1])
            ds = compute_diagnostics(column_profile(shifted))
            ang = rng.uniform(0, 2 * np.pi)
            rot = dict(c, u=c["u"] * np.cos(ang) - c["v"] * np.sin(ang), v=c["u"] * np.sin(ang) + c["v"] * np.cos(ang))
            dr = compute_diagnostics(column_profile(rot))
            for k in keys:
                self.assertAlmostEqual(base[k], ds[k], places=5, msg=f"galilean {k}")
                self.assertAlmostEqual(base[k], dr[k], places=5, msg=f"rotation {k}")
            self.assertAlmostEqual(ds["storm_motion_u"], base["storm_motion_u"] + a[0], places=5)

    def test_hemisphere_mirror_on_random_winds(self):
        for c in COLS[:60]:
            n = compute_diagnostics(column_profile(c), hemisphere="N")
            s = compute_diagnostics(column_profile(dict(c, v=-c["v"])), hemisphere="S")
            for k in ("srh_0_1km", "srh_0_3km", "shear_0_6km", "sr_wind_0_2km"):
                self.assertAlmostEqual(n[k], s[k], places=5, msg=k)

    def test_level_doubling_invariance(self):
        """Inserting levels that lie exactly on the engine's interpolant must not change any diagnostic."""
        for c in COLS[:40]:
            sub = slice(0, None, 4)                                            # 400 m spacing
            p, T, q, u, v, z = (c[k][sub] for k in ("p", "T", "q", "u", "v", "z"))
            w = q / (1 - q)
            pm = np.sqrt(p[:-1] * p[1:]); wm = 0.5 * (w[:-1] + w[1:])
            def dbl(a, m):
                out = np.empty(a.size + m.size); out[0::2] = a; out[1::2] = m; return out
            base = Profile(p, T, q, u, v, z)
            fine = Profile(dbl(p, pm), dbl(T, 0.5 * (T[:-1] + T[1:])), dbl(q, wm / (1 + wm)),
                           dbl(u, 0.5 * (u[:-1] + u[1:])), dbl(v, 0.5 * (v[:-1] + v[1:])), dbl(z, 0.5 * (z[:-1] + z[1:])))
            a, b = compute_diagnostics(base), compute_diagnostics(fine)
            same(a, b, 2e-3, "level-doubling")

    def test_grid_convergence(self):
        picks = [c for c, d in zip(COLS, DIAG) if d["SBCAPE"] > 100][:25]
        self.assertGreater(len(picks), 10)
        for c in picks:
            a = compute_diagnostics(column_profile(c), dp=1.0)
            b = compute_diagnostics(column_profile(c), dp=0.25)
            for k in ("SBCAPE", "MLCAPE", "MUCAPE"):
                self.assertLessEqual(abs(a[k] - b[k]), max(3.0, 0.01 * b[k]), k)
            self.assertLessEqual(abs(a["SBCIN"] - b["SBCIN"]), max(3.0, 0.02 * abs(b["SBCIN"])))

    def test_warmer_surface_parcel_has_more_cape(self):
        n = 0
        for c, d in zip(COLS, DIAG):
            if d["SBCAPE"] > 200:
                T = c["T"].copy(); T[0] += 2.0
                d2 = compute_diagnostics(column_profile(dict(c, T=T)))
                self.assertGreaterEqual(d2["SBCAPE"], d["SBCAPE"] - 1.0)
                n += 1
        self.assertGreater(n, 10)


def reference_cape_cin(prof, p0, T0, Td0):
    """Independent re-derivation: height-space integral, tight-tolerance ODE solve, brute-force LFC/EL scan."""
    z = prof.z_agl
    zf = np.arange(0.0, z[-1], 10.0)
    lnp_f = np.interp(zf, z, np.log(prof.p))
    p_f = np.exp(lnp_f)
    Te = np.interp(zf, z, prof.T)
    we = np.interp(zf, z, th.mixing_ratio_from_q(prof.q))
    p_l, T_l = (float(x) for x in th.lcl(p0, T0, Td0))
    e0 = float(th.sat_vapor_pressure(min(Td0, T0)))
    w0 = 0.6219569 * e0 / (p0 - e0)
    Tp = np.empty_like(zf); wp = np.empty_like(zf)
    dry = p_f >= p_l
    Tp[dry] = T0 * (p_f[dry] / p0) ** KAPPA; wp[dry] = w0
    if (~dry).any():
        sol = solve_ivp(lambda p, T: [th._dTdp_moist(p, T[0])], (p_l, p_f[~dry].min() - 1e-6), [T_l],
                        method="DOP853", rtol=1e-10, atol=1e-10, dense_output=True)
        Tp[~dry] = sol.sol(p_f[~dry])[0]
        wp[~dry] = th.saturation_mixing_ratio(p_f[~dry], Tp[~dry])
    Tve, Tvp = th.virtual_temperature(Te, we), th.virtual_temperature(Tp, wp)
    B = (Tvp - Tve) / Tve * G                                               # m s-2
    above = np.nonzero(p_f <= p_l)[0]
    cape, lfc_idx = 0.0, None
    if above.size:                                                          # brute-force scan of buoyant layers
        i0 = above[0]
        j = i0
        while j < len(zf):
            if B[j] > 0:
                k = j
                while k + 1 < len(zf) and B[k + 1] > 0:
                    k += 1
                area = float(np.trapezoid(B[max(j - 1, i0):k + 2], zf[max(j - 1, i0):k + 2]))
                if area > cape:
                    cape, lfc_idx = area, j
                j = k + 1
            else:
                j += 1
    if cape < 0.5:
        cape, lfc_idx = 0.0, None
    if lfc_idx is None:                                                     # no LFC: engine integrates CIN to 500 hPa
        end = int(np.searchsorted(-p_f, -max(500.0, prof.p[-1])))
    else:
        end = lfc_idx
    cin = float(np.trapezoid(np.minimum(B[:end], 0.0), zf[:end])) if end > 1 else 0.0
    return cape, cin


class TestAgainstIndependentReference(unittest.TestCase):
    def test_sb_cape_cin_match_height_space_reference(self):
        worst_cape = worst_cin = 0.0
        n = 0
        for c, d in zip(COLS, DIAG):
            if d["SBCAPE"] < 50 and d["SBCIN"] > -50:
                continue
            prof = column_profile(c, with_z=False)                           # hydrostatic heights: consistent with p
            ours = compute_diagnostics(prof)
            ref_cape, ref_cin = reference_cape_cin(prof, prof.p[0], prof.T[0], float(th.dewpoint(prof.p[0], prof.q[0])))
            worst_cape = max(worst_cape, abs(ours["SBCAPE"] - ref_cape) / max(ref_cape, 100.0))
            worst_cin = max(worst_cin, abs(ours["SBCIN"] - ref_cin) / max(abs(ref_cin), 100.0))
            n += 1
            if n >= 60:
                break
        print(f"\n  reference comparison over {n} columns: worst CAPE rel. diff {worst_cape:.4f}, worst CIN rel. diff {worst_cin:.4f}")
        self.assertGreater(n, 25)
        self.assertLess(worst_cape, 0.03)
        self.assertLess(worst_cin, 0.05)

    def test_moist_adiabat_integrator_matches_scipy(self):
        p = np.arange(900.0, 150.0, -1.0)
        ours = th.moist_ascent(p, 295.0)
        sol = solve_ivp(lambda pp, T: [th._dTdp_moist(pp, T[0])], (p[0], p[-1]), [295.0], method="DOP853",
                        rtol=1e-11, atol=1e-11, t_eval=p)
        self.assertLess(np.max(np.abs(ours - sol.y[0])), 1e-4)


class TestRobustness(unittest.TestCase):
    def test_degenerate_inputs_never_crash_or_nan(self):
        base = COLS[3]
        variants = {
            "bone_dry": dict(base, q=np.zeros_like(base["q"])),
            "saturated": dict(base, q=th.q_from_mixing_ratio(th.saturation_mixing_ratio(base["p"], base["T"]) * 0.999)),
            "very_cold": dict(base, T=np.maximum(base["T"] - 45.0, 160.0)),
            "very_warm": dict(base, T=np.minimum(base["T"] + 30.0, 335.0)),
            "calm": dict(base, u=0 * base["u"], v=0 * base["v"]),
            "isothermal": dict(base, T=np.full_like(base["T"], 250.0)),
        }
        for name, col in variants.items():
            d = compute_diagnostics(column_profile(col, with_z=False))
            for k in ("SBCAPE", "MLCAPE", "MUCAPE", "SBCIN", "PWAT"):
                self.assertTrue(np.isfinite(d[k]), (name, k, d[k]))
        self.assertEqual(compute_diagnostics(column_profile(variants["bone_dry"], with_z=False))["SBCAPE"], 0.0)

    def test_truncated_and_elevated_columns(self):
        c = COLS[10]
        keep = c["p"] >= 400.0                                                # top at ~400 hPa
        col = {k: (v[keep] if isinstance(v, np.ndarray) else v) for k, v in c.items()}
        d = compute_diagnostics(column_profile(col))
        self.assertTrue(np.isfinite(d["SBCAPE"]))
        hi = random_column(np.random.default_rng(5), force_elevated=True)
        d = compute_diagnostics(column_profile(hi))
        self.assertTrue(math.isnan(d["lapse_700_500"]) or hi["p_sfc"] >= 700)

    def test_input_not_mutated(self):
        pr = column_profile(COLS[0]); before = (pr.p.copy(), pr.T.copy(), pr.q.copy(), pr.u.copy(), pr.z.copy())
        compute_diagnostics(pr)
        for a, b in zip(before, (pr.p, pr.T, pr.q, pr.u, pr.z)):
            np.testing.assert_array_equal(a, b)


if __name__ == "__main__":
    unittest.main()
