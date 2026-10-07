import sys, os, unittest
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from skywatch import Profile, compute_diagnostics, compute_batch
from skywatch.reference_soundings import isa_profile, weisman_klemp, moist_adiabatic_env
from skywatch import thermo as th


class TestInstability(unittest.TestCase):
    def test_weisman_klemp_cape_matches_literature_range(self):
        d = compute_diagnostics(weisman_klemp())
        self.assertTrue(1800 < d["SBCAPE"] < 2800, d["SBCAPE"])
        self.assertLess(d["SBCIN"], 0.0)
        self.assertTrue(d["SB_LCL"] < d["SB_LFC"] < d["SB_EL"])
        self.assertTrue(10000 < d["SB_EL"] < 14000, d["SB_EL"])      # EL near the tropopause
        self.assertTrue(40 < d["PWAT"] < 60, d["PWAT"])

    def test_dry_adiabatic_dry_air_has_no_cape(self):
        p = np.arange(1000.0, 99.0, -25.0)
        T = 300.0 * (p / 1000.0) ** th.KAPPA_EXPONENT
        d = compute_diagnostics(Profile(p, T, np.full_like(p, 1e-6), 0 * p, 0 * p))
        self.assertLess(d["SBCAPE"], 1.0)                      # numerical noise only

    def test_parcel_following_environment_has_near_zero_cape(self):
        d = compute_diagnostics(moist_adiabatic_env(), dp=1.0)
        self.assertLess(d["SBCAPE"], 40.0)

    def test_more_low_level_moisture_means_more_cape(self):
        base = weisman_klemp(q_sfc_cap=0.012)
        moist = weisman_klemp(q_sfc_cap=0.016)
        self.assertGreater(compute_diagnostics(moist)["SBCAPE"], compute_diagnostics(base)["SBCAPE"])

    def test_stable_inversion_profile_has_no_artificial_cape(self):
        z = np.arange(0, 12001, 250.0)
        T = 288.15 - 0.004 * z + np.where(z < 1500, 0.0, 0.0)
        T = np.where(z < 800, 285.0 + 0.004 * z, T - 3.0)         # strong surface inversion, stable above
        p = 1013.25 * np.exp(-z / 8000.0)
        q = np.full_like(z, 0.004) * np.exp(-z / 2500.0)
        d = compute_diagnostics(Profile(p, T, q, 0 * z, 0 * z))
        self.assertEqual(d["SBCAPE"], 0.0)
        self.assertEqual(d["MLCAPE"], 0.0)

    def test_elevated_convection_mucape_exceeds_sbcape(self):
        # WK profile with a cold, drier surface layer: surface parcel is capped, a parcel from
        # just above the stable layer is not (03 s21 "elevated convection").
        wk = weisman_klemp()
        cold = 10.0 * np.clip(1.0 - wk.z / 1000.0, 0.0, 1.0)
        q = wk.q.copy(); q[wk.z < 1000.0] *= 0.55
        pr = Profile(wk.p, wk.T - cold, q, wk.u, wk.v)
        d = compute_diagnostics(pr)
        self.assertGreater(d["MUCAPE"], 1000.0)
        self.assertGreater(d["MUCAPE"], 3.0 * d["SBCAPE"])
        self.assertLess(d["MU_LCL_hpa"], pr.p[0] - 20.0)       # MU parcel was not the surface parcel

    def test_determinism(self):
        a, b = compute_diagnostics(weisman_klemp()), compute_diagnostics(weisman_klemp())
        for k in a:
            self.assertTrue((np.isnan(a[k]) and np.isnan(b[k])) or a[k] == b[k], k)

    def test_batch_matches_single(self):
        pr = weisman_klemp()
        out = compute_batch(pr.p, np.stack([pr.T] * 3), np.stack([pr.q] * 3),
                            np.zeros((3, pr.p.size)), np.zeros((3, pr.p.size)), z=np.stack([pr.z] * 3))
        self.assertEqual(out["SBCAPE"].shape, (3,))
        self.assertAlmostEqual(out["SBCAPE"][1], compute_diagnostics(pr)["SBCAPE"])


class TestMoistureAndThermo(unittest.TestCase):
    def test_pwat_constant_q(self):
        p = np.arange(1000.0, 499.0, -50.0)
        pr = Profile(p, np.full_like(p, 270.0), np.full_like(p, 0.01), 0 * p, 0 * p)
        self.assertAlmostEqual(compute_diagnostics(pr)["PWAT"], 0.01 * 50000.0 / 9.80665, delta=0.05)

    def test_freezing_level_isa(self):
        d = compute_diagnostics(isa_profile(np.arange(0, 12001, 250.0)))
        self.assertAlmostEqual(d["freezing_level"], 15.0 / 0.0065, delta=5.0)
        self.assertAlmostEqual(d["lapse_0_3km"], 6.5, delta=0.01)
        self.assertLessEqual(d["wet_bulb_zero"], d["freezing_level"])

    def test_freezing_level_zero_when_surface_is_cold(self):
        z = np.arange(0, 6001, 500.0)
        pr = Profile(1000 * np.exp(-z / 8000), 265.0 - 0.0065 * z, np.full_like(z, 1e-4), 0 * z, 0 * z)
        self.assertEqual(compute_diagnostics(pr)["freezing_level"], 0.0)


class TestWind(unittest.TestCase):
    Z = np.arange(0, 12001, 250.0)

    def test_bulk_shear_exact(self):
        d = compute_diagnostics(isa_profile(self.Z, u=lambda z: 0.004 * z))
        self.assertAlmostEqual(d["shear_0_1km"], 4.0, places=6)
        self.assertAlmostEqual(d["shear_0_3km"], 12.0, places=6)
        self.assertAlmostEqual(d["shear_0_6km"], 24.0, places=6)

    def test_bunkers_straight_shear_storm_motion(self):
        # u = S z: mean wind (S*3000, 0); right mover 7.5 m/s to the south of it
        S = 0.004
        d = compute_diagnostics(isa_profile(self.Z, u=lambda z: S * z), hemisphere="N")
        self.assertAlmostEqual(d["storm_motion_u"], S * 3000.0, places=6)
        self.assertAlmostEqual(d["storm_motion_v"], -7.5, places=6)
        d = compute_diagnostics(isa_profile(self.Z, u=lambda z: S * z), hemisphere="S")
        self.assertAlmostEqual(d["storm_motion_v"], +7.5, places=6)

    def test_srh_analytic_straight_hodograph(self):
        # SRH = -cy * S * H for u = S z, v = 0, storm motion (cx, cy). Bunkers gives cy = -7.5 (N)
        S, cy = 0.005, -7.5
        d = compute_diagnostics(isa_profile(self.Z, u=lambda z: S * z), hemisphere="N")
        self.assertAlmostEqual(d["srh_0_3km"], -cy * S * 3000.0, places=6)    # 112.5
        self.assertAlmostEqual(d["srh_0_1km"], -cy * S * 1000.0, places=6)    # 37.5

    def test_hemisphere_mirror_symmetry(self):
        u = lambda z: 5 + 0.004 * z * np.cos(z / 4000.0)
        v = lambda z: 3 * np.sin(z / 3000.0) + 0.001 * z
        north = compute_diagnostics(isa_profile(self.Z, u=u, v=v), hemisphere="N")
        south = compute_diagnostics(isa_profile(self.Z, u=u, v=lambda z: -v(z)), hemisphere="S")
        for k in ("srh_0_1km", "srh_0_3km", "shear_0_6km", "sr_wind_0_2km", "sr_wind_4_6km"):
            self.assertAlmostEqual(north[k], south[k], places=6, msg=k)
        self.assertAlmostEqual(north["veering_0_3km_deg"], -south["veering_0_3km_deg"], places=6)

    def test_veering_sign(self):
        # wind turning from southerly (180) at the surface to westerly (270) aloft = clockwise = +90
        z = self.Z
        frac = np.clip(z / 3000.0, 0, 1)
        ang = np.radians(180 + 90 * frac)                     # meteorological "from" direction
        u, v = -10 * np.sin(ang), -10 * np.cos(ang)
        d = compute_diagnostics(isa_profile(z, u=lambda zz: np.interp(zz, z, u), v=lambda zz: np.interp(zz, z, v)))
        self.assertAlmostEqual(d["veering_0_3km_deg"], 90.0, places=3)

    def test_short_profile_returns_nan_not_garbage(self):
        d = compute_diagnostics(isa_profile(np.arange(0, 4001, 250.0), u=lambda z: 0.004 * z))
        self.assertTrue(np.isnan(d["shear_0_6km"]))
        self.assertTrue(np.isnan(d["srh_0_3km"]))
        self.assertAlmostEqual(d["shear_0_3km"], 12.0, places=6)


class TestProfileValidation(unittest.TestCase):
    def test_rejects_bad_input(self):
        p = np.array([1000., 900., 800.])
        ok = dict(T=np.array([290., 285., 280.]), q=np.array([.01, .008, .005]), u=np.zeros(3), v=np.zeros(3))
        Profile(p, **ok)
        with self.assertRaises(ValueError): Profile(p[::-1], **ok)
        with self.assertRaises(ValueError): Profile(p, **{**ok, "q": np.array([.01, -1e-3, .005])})
        with self.assertRaises(ValueError): Profile(p, **{**ok, "T": np.array([290., np.nan, 280.])})

    def test_from_levels_drops_below_ground(self):
        lev = np.array([1000., 950., 850., 700., 500.])
        pr = Profile.from_levels(lev, [300, 296, 290, 280, 265], [.015, .012, .009, .005, .001],
                                 np.ones(5), np.ones(5), [100, 540, 1450, 3000, 5600],
                                 p_sfc=900.0, T2m=292.0, q2m=0.010, u10=2.0, v10=1.0, z_sfc=980.0)
        np.testing.assert_allclose(pr.p, [900, 850, 700, 500])
        self.assertEqual(pr.z_agl[0], 0.0)


if __name__ == "__main__":
    unittest.main()
