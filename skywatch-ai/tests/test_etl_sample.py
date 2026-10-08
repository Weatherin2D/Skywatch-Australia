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


if __name__ == "__main__":
    unittest.main()
