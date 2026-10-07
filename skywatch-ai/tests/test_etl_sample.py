"""Offline contract check for the real-data ETL assembler (no network)."""
from __future__ import annotations

import unittest
import numpy as np

from skywatch.contract import validate_sample
from skywatch.etl.build_sample import build_training_sample
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
    def test_teacher_sonde_sample_passes_contract(self):
        rng = np.random.default_rng(7)
        truth = random_column(rng)
        teacher_col = random_column(rng)
        # Blur teacher relative to truth
        teacher_col["T"] = teacher_col["T"] * 0.02 + truth["T"] * 0.98
        sonde = _col_dict(truth)
        teacher = _col_dict(teacher_col)
        teacher["p_sfc"] = float(teacher["p"][0])
        norm = Normalizer.default(make_vertical_grid())
        sample = build_training_sample(
            teacher, sonde, lat=-31.95, lon=115.86, norm=norm, rng=rng
        )
        errs = validate_sample(sample, norm)
        self.assertEqual(errs, [], errs)


if __name__ == "__main__":
    unittest.main()
