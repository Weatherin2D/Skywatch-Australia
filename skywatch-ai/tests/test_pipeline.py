import sys, os, unittest, tempfile
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from skywatch import Profile, compute_diagnostics
from skywatch.grid import make_vertical_grid, level_index, STANDARD_LEVELS, valid_levels
from skywatch.normalizer import Normalizer, PROFILE_VARS
from skywatch.obs_tokens import (significant_levels, encode_tokens, raw_surface, raw_from_sounding, RawObs,
                                 TOKEN_VARS, SOURCES, N_TOKEN_FEATS)
from skywatch.synthetic import make_dataset, stack, random_column, column_profile, column_on_grid, surface_vector
from skywatch.contract import validate_sample
from skywatch import baselines as bl
from skywatch.ensemble import sample_normalized, run_engine
from skywatch.evaluate import evaluate_batch, check_targets, inversion_strength
from skywatch import lossmath as lm
from skywatch.io import read_sounding_csv
from skywatch.nn.schedule import LossSchedule, ScheduleConfig
from skywatch.profile import hydrostatic_heights

GRID = make_vertical_grid()
NORM = Normalizer.default(GRID)
DS = make_dataset(120, seed=7)
BATCH = stack(DS)


class TestGridAndNormalizer(unittest.TestCase):
    def test_grid(self):
        self.assertTrue(50 <= len(GRID) <= 100)
        self.assertTrue(np.all(np.diff(GRID) < 0))
        self.assertEqual(list(GRID[level_index(GRID, STANDARD_LEVELS)]), list(STANDARD_LEVELS))
        self.assertLessEqual(np.diff(-GRID[GRID >= 800]).max(), 10.0 + 1e-9)       # fine spacing in the boundary layer
        np.testing.assert_array_equal(valid_levels(GRID, np.array([1000.0, 850.0])).sum(1), [(GRID <= 1000).sum(), (GRID <= 850).sum()])

    def test_normalizer_roundtrip_fit_and_serialisation(self):
        x = np.random.default_rng(0).normal(size=(4, 5, len(GRID)))
        np.testing.assert_allclose(NORM.decode_profile(NORM.encode_profile(x)), x)
        fit = Normalizer.fit(GRID, NORM.decode_profile(BATCH["target_profile"]), BATCH["valid"], NORM.decode_surface(BATCH["target_surface"]))
        self.assertTrue(np.all(np.isfinite(fit.p_std)) and np.all(fit.p_std > 0))
        again = Normalizer.from_dict(fit.to_dict())
        np.testing.assert_allclose(again.p_mean, fit.p_mean)
        # humidity: relative error maps straight to ln-space sigma
        self.assertAlmostEqual(float(NORM.encode_sigma("q", 0.1 * 0.004, 0.004, 850.0)) * NORM.stats_at("q", 850.0)[1], 0.1)


class TestTokens(unittest.TestCase):
    def test_significant_levels_keep_the_inversion(self):
        z = np.linspace(0, 3000, 400)
        T = 290 - 0.0065 * z + 5.0 * np.clip((z - 900) / 120.0, 0, 1)             # sharp 5 K inversion at 900-1020 m
        idx = significant_levels(z, T, 12)
        self.assertEqual(len(idx), 12)
        self.assertIn(0, idx); self.assertIn(399, idx)
        recon = np.interp(z, z[idx], T[idx])
        uni = np.linspace(0, 399, 12).round().astype(int)
        err_rdp, err_uni = np.abs(recon - T).max(), np.abs(np.interp(z, z[uni], T[uni]) - T).max()
        self.assertLess(err_rdp, 0.3); self.assertLess(err_rdp, 0.5 * err_uni)

    def test_encode_tokens_shapes_masks_and_accounting(self):
        col = random_column(np.random.default_rng(3))
        raw = RawObs.concat([raw_from_sounding(NORM, col["p"], col["T"], col["q"], col["u"], col["v"], lat=-33.9, lon=151.2, n_sig=20),
                             raw_surface(NORM, dict(T2m=290.0, q2m=0.008, u10=2.0, v10=-1.0, p_sfc=1010.0), lat=-33.8, lon=151.1)])
        tok, info = encode_tokens(raw, NORM, lat0=-33.9, lon0=151.2, max_tokens=64)
        self.assertEqual(tok["tok_feat"].shape, (64, N_TOKEN_FEATS))
        self.assertEqual(int(tok["tok_mask"].sum()), 64 if len(raw) >= 64 else len(raw))
        self.assertTrue(np.isfinite(tok["tok_feat"]).all())
        self.assertTrue(tok["tok_var"].max() < len(TOKEN_VARS) and tok["tok_src"].max() < len(SOURCES))
        self.assertEqual(info["n_in"], len(raw)); self.assertEqual(info["n_dropped_budget"], max(0, len(raw) - 64))
        tok2, _ = encode_tokens(raw, NORM, lat0=-33.9, lon0=151.2, max_tokens=64)
        for k in tok: np.testing.assert_array_equal(tok[k], tok2[k])               # deterministic

    def test_rejected_and_nan_observations_are_counted_not_tokenised(self):
        raw = raw_surface(NORM, dict(T2m=290.0, q2m=0.008, u10=np.nan, v10=-1.0, p_sfc=1010.0), lat=-33, lon=151)
        raw.quality[0] = 0.0                                                        # QC-rejected
        tok, info = encode_tokens(raw, NORM, lat0=-33, lon0=151, max_tokens=16)
        self.assertEqual(info["n_dropped_invalid"], 2); self.assertEqual(int(tok["tok_mask"].sum()), 3)

    def test_empty_and_unknown_inputs(self):
        tok, info = encode_tokens(RawObs.concat([]), NORM, lat0=0, lon0=0, max_tokens=8)
        self.assertFalse(tok["tok_mask"].any()); self.assertEqual(info["n_in"], 0)
        raw = raw_surface(NORM, dict(T2m=290.0), lat=0, lon=0); raw.var[0] = "mystery"
        with self.assertRaises(ValueError): encode_tokens(raw, NORM, lat0=0, lon0=0)


class TestContract(unittest.TestCase):
    def test_all_synthetic_samples_pass(self):
        for i, s in enumerate(DS):
            self.assertEqual(validate_sample(s, NORM), [], f"sample {i}")

    def test_validator_catches_real_pipeline_mistakes(self):
        s = {k: v.copy() for k, v in DS[0].items()}
        bad = dict(s, target_profile=NORM.decode_profile(s["target_profile"]).astype(np.float32))      # forgot to normalise
        self.assertTrue(validate_sample(bad, NORM))
        nan = dict(s, teacher_profile=np.where(np.arange(len(GRID)) == 3, np.nan, s["teacher_profile"]).astype(np.float32)); self.assertTrue(validate_sample(nan, NORM))
        below = dict(s, obs_mask=np.ones_like(s["obs_mask"])); self.assertTrue(any("below ground" in e for e in validate_sample(below, NORM)) or s["valid"].all())
        zero = dict(s, obs_mask=np.ones_like(s["obs_mask"]) & s["valid"][None], obs_sigma=np.zeros_like(s["obs_sigma"]))
        self.assertTrue(any("uncertainty" in e for e in validate_sample(zero, NORM)))
        short = {k: v for k, v in s.items() if k != "valid"}; self.assertTrue(validate_sample(short, NORM))

    def test_high_terrain_sample_requires_filled_below_ground_levels(self):
        hi = [x for x in DS if not x["valid"].all()][0]
        self.assertEqual(validate_sample(hi, NORM), [])
        raw = {k: v.copy() for k, v in hi.items()}
        raw["teacher_profile"][:, :3] = 40.0                                      # extrapolated reanalysis junk
        self.assertTrue(validate_sample(raw, NORM))


class TestBaselinesAndEngineBridge(unittest.TestCase):
    def test_baselines(self):
        v = BATCH["valid"][:, None, :]
        err = lambda f: float((np.abs(f(BATCH)[0] - BATCH["target_profile"]) * v).sum() / (v.sum() * 5))
        a, b, c = err(bl.predict_A), err(bl.predict_B), err(bl.predict_C)
        tr, te = {k: x[:80] for k, x in BATCH.items()}, {k: x[80:] for k, x in BATCH.items()}
        d_model = bl.RidgeBaseline().fit(tr)
        pd_, ps_ = d_model.predict(te)
        vt = te["valid"][:, None, :]
        d = float((np.abs(pd_ - te["target_profile"]) * vt).sum() / (vt.sum() * 5))
        bt = float((np.abs(te["teacher_profile"] - te["target_profile"]) * vt).sum() / (vt.sum() * 5))
        print(f"\n  baseline MAE (normalised): A={a:.3f} B={b:.3f} C={c:.3f}; holdout B={bt:.3f} D(ridge)={d:.3f}")
        self.assertGreater(a, b)                                                    # extra grid-offset error in A
        self.assertTrue(np.isfinite([a, b, c, d]).all()); self.assertEqual(pd_.shape, te["teacher_profile"].shape)

    def test_vertically_coherent_sampling(self):
        mu = np.zeros((2, 5, len(GRID))); sg = np.full_like(mu, 2.0)
        x = sample_normalized(mu, sg, 4000, np.random.default_rng(0), length=4.0)
        self.assertEqual(x.shape, (4000, 2, 5, len(GRID)))
        self.assertAlmostEqual(float(x.std()), 2.0, delta=0.05)
        lag1 = np.corrcoef(x[..., 10].ravel(), x[..., 11].ravel())[0, 1]
        lag20 = np.corrcoef(x[..., 10].ravel(), x[..., 30].ravel())[0, 1]
        self.assertAlmostEqual(lag1, np.exp(-1 / 4.0), delta=0.04); self.assertLess(abs(lag20), 0.05)
        np.testing.assert_array_equal(x[:3], sample_normalized(mu, sg, 3, np.random.default_rng(0), 4.0)[:3])

    def test_internal_grid_preserves_convective_and_inversion_information(self):
        """Native 100 m column -> 57-level grid -> engine must reproduce the diagnostics (design check on the grid)."""
        rng = np.random.default_rng(11)
        cols = [random_column(rng) for _ in range(120)]
        prof, surf, zs, valid = [], [], [], []
        for c in cols:
            z_sfc = 0.0
            p_, v_ = column_on_grid(c, GRID, z_sfc)
            prof.append(NORM.encode_profile(p_)); surf.append(NORM.encode_surface(surface_vector(c))); zs.append(z_sfc); valid.append(v_)
        out = run_engine(NORM, np.array(prof), np.array(surf), np.array(zs))
        ref = [compute_diagnostics(column_profile(c)) for c in cols]
        cg, cr = out["SBCAPE"], np.array([r["SBCAPE"] for r in ref])
        corr = np.corrcoef(cg, cr)[0, 1]
        big = cr > 1500
        mae_big = np.abs(cg[big] - cr[big]).mean()
        sh = np.nanmean(np.abs(out["shear_0_6km"] - np.array([r["shear_0_6km"] for r in ref])))
        inv = [(inversion_strength(column_profile(c).T, column_profile(c).z_agl)[0] >= 1.5) for c in cols]
        print(f"\n  grid fidelity (120 random columns): SBCAPE corr {corr:.4f}, MAE where CAPE>1500: {mae_big:.0f} J/kg, "
              f"shear MAE {sh:.2f} m/s, engine failures {int(out['_failed'].sum())}, hydro fallbacks {int(out['_fallback'].sum())}")
        self.assertEqual(int(out["_failed"].sum()), 0)
        self.assertGreater(corr, 0.97); self.assertLess(mae_big, 250.0); self.assertLess(sh, 0.5)


class TestEvaluate(unittest.TestCase):
    def test_perfect_prediction_and_noisy_prediction(self):
        B = 60
        tp, ts, v = BATCH["target_profile"][:B], BATCH["target_surface"][:B], BATCH["valid"][:B]
        zs = BATCH["z_sfc"][:B]
        m = evaluate_batch(NORM, tp, ts, tp, ts, v, zs, pred_sigma=np.full_like(tp, 0.5))
        self.assertAlmostEqual(m["T_rmse_K"], 0.0, places=6); self.assertAlmostEqual(m["cape_corr"], 1.0, places=6)
        self.assertEqual(m["inversion_hit_rate"], 1.0); self.assertEqual(m["artificial_cape_rate"], 0.0)
        rng = np.random.default_rng(0)
        noisy = tp + rng.normal(0, 0.1, tp.shape).astype(np.float32)
        m2 = evaluate_batch(NORM, noisy, ts, tp, ts, v, zs, pred_sigma=np.full_like(tp, 0.1))
        self.assertGreater(m2["T_rmse_K"], 0.0); self.assertLess(m2["T_rmse_K"], 1.0)
        self.assertAlmostEqual(m2["coverage_80"], 0.8, delta=0.04)                  # sigma matches the injected noise
        self.assertTrue(set(check_targets(m)) == {"T_rmse_K", "vector_wind_rmse_ms", "cape_corr", "high_cape_mae", "inversion_hit_rate", "artificial_cape_rate"})

    def test_inversion_strength(self):
        z = np.arange(0, 2000, 100.0); T = 290 - 0.0065 * z; T[5:8] += np.array([1.0, 3.0, 4.0])
        s, base = inversion_strength(T, z)
        self.assertAlmostEqual(s, 4.0 - 0.0065 * 300, places=6); self.assertEqual(base, 400.0)   # T[7] - T[4]


class TestSoundingCSV(unittest.TestCase):
    def test_roundtrip(self):
        import pandas as pd
        c = random_column(np.random.default_rng(21), force_inversion=False)
        k = np.arange(0, len(c["z"]), 3)
        from skywatch import thermo as th
        Td = th.dewpoint(c["p"][k], c["q"][k]) - 273.15
        spd = np.hypot(c["u"][k], c["v"][k]) / 0.514444
        drc = (270 - np.degrees(np.arctan2(c["v"][k], c["u"][k]))) % 360
        df = pd.DataFrame({"PRES": c["p"][k], "HGHT": c["z"][k] + 50, "TEMP": c["T"][k] - 273.15, "DWPT": Td, "DRCT": drc, "SKNT": spd})
        df.loc[7, "SKNT"] = np.nan; df.loc[3, "TEMP"] = np.nan
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.csv"); df.to_csv(path, index=False)
            prof, meta = read_sounding_csv(path, wind_units="kt")
        self.assertEqual(meta["rows_dropped"], 1); self.assertEqual(meta["winds_interpolated"], 1)
        ref = compute_diagnostics(column_profile({**c, **{n: c[n][k] for n in ("p", "T", "q", "u", "v", "z")}}))
        got = compute_diagnostics(prof)
        for key in ("SBCAPE", "PWAT", "shear_0_6km"):
            self.assertAlmostEqual(got[key], ref[key], delta=max(0.03 * abs(ref[key]), 40.0 if key == "SBCAPE" else 0.3), msg=key)


class TestLossMath(unittest.TestCase):
    def test_crps_matches_numerical_definition(self):
        for mu, sg, y in [(0.3, 1.2, -0.5), (-2.0, 0.4, -1.0), (1.0, 3.0, 4.0)]:
            from scipy.special import erf
            F = lambda x: 0.5 * (1 + erf((x - mu) / (sg * np.sqrt(2))))
            xl, xr = np.linspace(mu - 40 * sg, min(y, mu + 40 * sg), 200001), np.linspace(max(y, mu - 40 * sg), mu + 40 * sg, 200001)
            ref = np.trapezoid(F(xl) ** 2, xl) + np.trapezoid((F(xr) - 1) ** 2, xr)       # split at the indicator's jump
            self.assertAlmostEqual(float(lm.gaussian_crps(mu, sg, y)), ref, places=4)
        self.assertAlmostEqual(float(lm.gaussian_crps(1.0, 1e-9, 3.0)), 2.0, places=5)        # -> |mu - y| as sigma -> 0

    def test_crps_is_a_proper_score(self):
        y = np.random.default_rng(0).normal(0, 1.0, 200000)
        sig = np.array([0.5, 0.8, 1.0, 1.25, 2.0])
        score = [lm.gaussian_crps(0.0, s, y).mean() for s in sig]
        self.assertEqual(sig[int(np.argmin(score))], 1.0)

    def test_physics_terms(self):
        c = random_column(np.random.default_rng(2))
        p_, _ = column_on_grid(c, GRID)
        T, q = p_[0], np.exp(p_[1])
        Z = hydrostatic_heights(GRID, T, q)
        self.assertLess(np.abs(lm.hydrostatic_residual(T, q, Z, GRID)).max(), 0.5)         # consistent column -> ~0
        self.assertGreater(np.abs(lm.hydrostatic_residual(T, q, Z + np.linspace(0, 300, len(GRID)), GRID)).max(), 5.0)
        from skywatch import thermo as th
        qs = th.q_from_mixing_ratio(th.saturation_mixing_ratio(GRID, T))
        self.assertEqual(float(lm.supersaturation_excess(T, 0.98 * qs, GRID).max()), 0.0)
        self.assertGreater(float(lm.supersaturation_excess(T, 1.5 * qs, GRID).min()), 0.4)
        Zs = np.linspace(0, 10000, 101); Td = 300 - 0.0098 * Zs
        self.assertEqual(float(lm.superadiabatic_excess(Td, Zs).max()), 0.0)
        self.assertGreater(float(lm.superadiabatic_excess(300 - 0.0098 * 1.6 * Zs, Zs).min()), 0.4)

    def test_gradient_loss(self):
        a = np.random.default_rng(0).normal(size=(3, 5, 10)); valid = np.ones((3, 10), bool)
        self.assertEqual(lm.vertical_gradient_l1(a, a, valid), 0.0)
        self.assertAlmostEqual(lm.vertical_gradient_l1(a + 7.0, a, valid), 0.0, places=12)               # constant offset has no gradient error
        self.assertGreater(lm.vertical_gradient_l1(a + np.arange(10), a, valid), 0.9)


class TestSchedule(unittest.TestCase):
    def test_stages_and_ramps(self):
        s = LossSchedule(ScheduleConfig(total_steps=1000))
        w0, wm, wend = s.weights(0), s.weights(500), s.weights(1000)
        self.assertEqual((w0["stage"], w0["obs"], w0["grad"], w0["phys"], w0["unc"]), ("teacher", 0.0, 0.0, 0.0, 0.0))
        self.assertAlmostEqual(w0["alpha"], 0.2); self.assertEqual(wend["alpha"], 1.0)
        self.assertEqual(wm["stage"], "structure")
        self.assertGreater(wm["obs"], 0); self.assertGreater(wm["grad"], 0); self.assertEqual(wm["unc"], 0.0)
        self.assertAlmostEqual(wend["obs"], 0.5); self.assertAlmostEqual(wend["phys"], 0.05); self.assertAlmostEqual(wend["unc"], 0.1)
        for k in ("obs", "grad", "phys", "unc", "alpha"):
            vals = [s.weights(i)["obs" if k == "obs" else k] for i in range(0, 1001, 10)]
            self.assertEqual(vals, sorted(vals), k)                                      # never decreases
        self.assertFalse(s.weights(850)["event_finetune"]); self.assertTrue(s.weights(950)["event_finetune"])
        self.assertEqual(s.weights(950)["lr_mult"], 0.3)


if __name__ == "__main__":
    unittest.main()
