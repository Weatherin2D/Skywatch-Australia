"""Run on a machine WITH torch: checks the torch losses/model against the numpy reference maths. Skipped otherwise."""
import sys, os, unittest
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

from skywatch import lossmath as lm
from skywatch.grid import make_vertical_grid
from skywatch.normalizer import Normalizer
from skywatch.synthetic import random_column, column_on_grid, make_dataset, stack, N_FIELD_CHANNELS, N_STATIC, N_HIST

GRID = make_vertical_grid(); NORM = Normalizer.default(GRID)


@unittest.skipUnless(HAS_TORCH, "PyTorch not installed")
class TestTorchParity(unittest.TestCase):
    def setUp(self):
        from skywatch.nn import losses as tl
        self.tl = tl

    def test_crps(self):
        r = np.random.default_rng(0)
        mu, sg, y = r.normal(size=500), r.uniform(0.05, 3, 500), r.normal(size=500)
        got = self.tl.gaussian_crps(torch.tensor(mu), torch.tensor(sg), torch.tensor(y)).numpy()
        np.testing.assert_allclose(got, lm.gaussian_crps(mu, sg, y), rtol=1e-6, atol=1e-8)

    def test_gradient_loss(self):
        r = np.random.default_rng(1)
        pred, tgt = r.normal(size=(4, 5, len(GRID))), r.normal(size=(4, 5, len(GRID)))
        valid = np.ones((4, len(GRID)), bool); valid[:, :7] = False
        b = dict(target_profile=torch.tensor(tgt), valid=torch.tensor(valid))
        out = dict(mean=torch.tensor(pred))
        lw = torch.ones(4, len(GRID), dtype=torch.double) * torch.tensor(valid, dtype=torch.double)
        got = float(self.tl.gradient_loss(out, b, self.tl.LossConfig(), lw))
        self.assertAlmostEqual(got, lm.vertical_gradient_l1(pred[:, :4], tgt[:, :4], valid), places=9)

    def test_physics_terms(self):
        col = random_column(np.random.default_rng(4))
        prof, valid = column_on_grid(col, GRID)
        mean = NORM.encode_profile(prof)[None]
        nt = self.tl.TorchNormalizer(NORM)
        hydro, ss, sa = self.tl.physics_terms(torch.tensor(mean, dtype=torch.float32), {}, nt)
        T, q, Z = prof[0], np.exp(prof[1]), prof[4]
        np.testing.assert_allclose(hydro[0].numpy(), lm.hydrostatic_residual(T, q, Z, GRID), atol=0.05)
        np.testing.assert_allclose(ss[0].numpy(), lm.supersaturation_excess(T, q, GRID), atol=1e-4)
        np.testing.assert_allclose(sa[0].numpy(), lm.superadiabatic_excess(T, Z), atol=1e-4)


@unittest.skipUnless(HAS_TORCH, "PyTorch not installed")
class TestModel(unittest.TestCase):
    def test_forward_identity_at_init_and_no_obs(self):
        from skywatch.nn.model import ModelConfig, V1SoundingModel
        cfg = ModelConfig(grid_p=tuple(float(p) for p in GRID), n_field_channels=N_FIELD_CHANNELS, n_static_channels=N_STATIC,
                          n_history=N_HIST, d_model=32, n_latent=2, n_heads=2, n_obs_layers=1, n_dec_layers=1, enc_channels=(16, 24, 32))
        m = V1SoundingModel(cfg).eval()
        b = {k: torch.as_tensor(v) for k, v in stack(make_dataset(4, seed=3)).items()}
        o = m(b)
        self.assertEqual(tuple(o["mean"].shape), (4, 5, len(GRID)))
        np.testing.assert_allclose(o["mean"].detach().numpy(), b["teacher_profile"].numpy(), atol=1e-6)
        b["tok_mask"] = torch.zeros_like(b["tok_mask"])
        self.assertTrue(torch.isfinite(m(b)["mean"]).all())


if __name__ == "__main__":
    unittest.main()
