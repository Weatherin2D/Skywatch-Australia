"""Offline contract check for the real-data ETL assembler (no network)."""
from __future__ import annotations

import unittest
import numpy as np

from skywatch.contract import validate_sample
from skywatch.grid import make_vertical_grid
from skywatch.normalizer import Normalizer
from skywatch.synthetic import random_column


def _col_dict(col):
    return {
        "p": col["p"][::5],
        "T": col["T"][::5],
        "q": col["q"][::5],
        "u": col["u"][::5],
        "v": col["v"][::5],
        "z": col["z"][::5],
        "p_sfc": float(col["p_sfc"]),
    }


class TestEtlSample(unittest.TestCase):
    def _pair(self, rng):
        truth = random_column(rng)
        teacher_col = random_column(rng)
        teacher_col["T"] = teacher_col["T"] * 0.02 + truth["T"] * 0.98
        sonde = _col_dict(truth)
        teacher = _col_dict(teacher_col)
        teacher["p_sfc"] = float(teacher["p"][0])
        return teacher, sonde

    def test_teacher_sonde_sample_passes_contract(self):
        from skywatch.etl.build_sample import build_training_sample

        rng = np.random.default_rng(7)
        teacher, sonde = self._pair(rng)
        norm = Normalizer.default(make_vertical_grid())
        sample = build_training_sample(
            teacher, sonde, lat=-31.95, lon=115.86, norm=norm, rng=rng
        )
        errs = validate_sample(sample, norm)
        self.assertEqual(errs, [], errs)

    def test_inference_sample_uses_independent_teacher(self):
        from skywatch.etl.build_sample import build_inference_sample

        rng = np.random.default_rng(11)
        teacher, sonde = self._pair(rng)
        norm = Normalizer.default(make_vertical_grid())
        sample = build_inference_sample(
            teacher, sonde, lat=-31.95, lon=115.86, norm=norm
        )
        # Teacher prior must not equal the radiosonde target (honest path).
        self.assertFalse(
            np.allclose(sample["teacher_profile"], sample["target_profile"], atol=1e-5)
        )
        self.assertTrue(bool(sample["tok_mask"].any()))

    def test_teacher_rejects_kmh_scale_winds(self):
        from skywatch.etl.openmeteo_teacher import _parse_hourly_column

        times = ["2026-10-06T00:00"]
        hourly = {"time": times}
        for p in (1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100):
            hourly[f"temperature_{p}hPa"] = [10.0]
            hourly[f"relative_humidity_{p}hPa"] = [50.0]
            hourly[f"wind_u_component_{p}hPa"] = [180.0]  # km/h-scale
            hourly[f"wind_v_component_{p}hPa"] = [0.0]
            hourly[f"geopotential_height_{p}hPa"] = [float(1000 - p) * 10]
        with self.assertRaisesRegex(RuntimeError, "km/h"):
            _parse_hourly_column(hourly, times, 0, -33.0, 151.0, "ifs", "test")

    def test_event_weight_rises_for_high_cape(self):
        from skywatch.etl.build_sample import event_weight_from_sonde
        from skywatch.synthetic import random_column

        rng = np.random.default_rng(42)
        # Search a handful of synthetic columns for one with elevated CAPE or inversion.
        weights = []
        for _ in range(40):
            col = random_column(rng)
            sonde = _col_dict(col)
            sonde["p_sfc"] = float(sonde["p"][0])
            weights.append(event_weight_from_sonde(sonde))
        self.assertTrue(any(w > 1.0 for w in weights), f"weights={weights[:10]}")
        self.assertTrue(all(w >= 1.0 for w in weights))


if __name__ == "__main__":
    unittest.main()
