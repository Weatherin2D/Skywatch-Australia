import sys, os, unittest
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from skywatch import thermo as th
from skywatch.constants import T0


class TestThermo(unittest.TestCase):
    def test_saturation_vapor_pressure(self):
        self.assertAlmostEqual(float(th.sat_vapor_pressure(T0)), 6.112, places=3)
        self.assertAlmostEqual(float(th.sat_vapor_pressure(T0 + 20)), 23.37, delta=0.05)

    def test_dewpoint_roundtrip_and_rh(self):
        T, p = np.array([250., 280., 300.]), 900.0
        q = th.q_from_mixing_ratio(th.saturation_mixing_ratio(p, T))
        np.testing.assert_allclose(th.dewpoint(p, q), T, atol=1e-6)
        np.testing.assert_allclose(th.relative_humidity(p, T, q), 1.0, atol=1e-9)

    def test_lcl_standard_case(self):
        p_l, T_l = th.lcl(1000.0, T0 + 30, T0 + 20)
        self.assertTrue(860 < float(p_l) < 880)           # ~1.2-1.3 km above surface
        self.assertTrue(T0 + 17 < float(T_l) < T0 + 20)   # LCL temperature is below the dew point

    def test_wet_bulb_known_psychrometric_value(self):
        # 20 C, 50 % RH, 1000 hPa -> Tw ~ 13.8 C
        e = 0.5 * float(th.sat_vapor_pressure(T0 + 20))
        w = 0.622 * e / (1000 - e)
        self.assertAlmostEqual(float(th.wet_bulb(1000.0, T0 + 20, w)) - T0, 13.8, delta=0.3)
        # saturated air: Tw == T
        ws = float(th.saturation_mixing_ratio(1000.0, T0 + 10))
        self.assertAlmostEqual(float(th.wet_bulb(1000.0, T0 + 10, ws)), T0 + 10, places=3)

    def test_theta_e_conserved_along_pseudo_adiabat(self):
        p = np.arange(1000.0, 250.0, -10.0)
        T, w, p_l, _ = th.parcel_profile(p, 303.15, 296.15)
        sat = p < p_l
        te = th.equivalent_potential_temperature(p[sat], T[sat], T[sat])
        te0 = float(th.equivalent_potential_temperature(1000.0, 303.15, 296.15))
        self.assertLess(np.max(np.abs(te - te0)), 1.5)    # Bolton fit vs. numerical integration


if __name__ == "__main__":
    unittest.main()
