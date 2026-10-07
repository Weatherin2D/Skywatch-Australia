#!/usr/bin/env python
"""End-to-end check of the neural pipeline on SYNTHETIC data. Run this first on a machine with PyTorch:

    python scripts/smoke_test.py                 # ~1-3 min on CPU
    python scripts/smoke_test.py --steps 3000 --n-train 3000 --d-model 128 --strict   # real learning check

HARD checks (exit code 1 on failure): shapes, finiteness, untrained model == teacher prior, observation-free samples,
below-ground masking in the losses, gradient flow to every parameter, loss/val sanity, engine can ingest predictions,
checkpoint round-trip. SOFT check: does the model actually beat the teacher where observations exist (--strict makes it hard).
Synthetic data validates plumbing and learnability only - it says nothing about skill on real weather.
"""
import argparse, os, sys, tempfile, time
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try:
    import torch
except ImportError:
    print("PyTorch is not installed. `pip install torch` (>=2.0) and re-run."); sys.exit(2)

from skywatch.grid import make_vertical_grid
from skywatch.normalizer import Normalizer
from skywatch.synthetic import make_dataset, stack, N_FIELD_CHANNELS, N_STATIC, N_HIST
from skywatch.contract import validate_sample
from skywatch.evaluate import check_targets
from skywatch.nn.model import ModelConfig, V1SoundingModel
from skywatch.nn.losses import LossConfig, TorchNormalizer, total_loss
from skywatch.nn.schedule import ScheduleConfig
from skywatch.nn.data import make_loader, to_device
from skywatch.nn.train import TrainConfig, train, predict, quick_val, run_evaluation, format_table, load_checkpoint

ap = argparse.ArgumentParser()
ap.add_argument("--n-train", type=int, default=500); ap.add_argument("--n-val", type=int, default=100)
ap.add_argument("--steps", type=int, default=400); ap.add_argument("--batch-size", type=int, default=16)
ap.add_argument("--d-model", type=int, default=64); ap.add_argument("--lr", type=float, default=5e-4)
ap.add_argument("--seed", type=int, default=0); ap.add_argument("--strict", action="store_true")
ap.add_argument("--out-dir", default=None)
args = ap.parse_args()

results = []
def check(name, ok, detail="", hard=True):
    results.append((name, bool(ok), hard))
    print(f"[{'PASS' if ok else ('FAIL' if hard else 'WARN')}] {name}" + (f" - {detail}" if detail else ""))

grid = make_vertical_grid(); norm = Normalizer.default(grid); norm_t = TorchNormalizer(norm)
t0 = time.time()
data = make_dataset(args.n_train + args.n_val, seed=args.seed + 100, grid_p=grid, norm=norm)
train_s, val_s = data[:args.n_train], data[args.n_train:]
check("synthetic samples satisfy the data contract", all(validate_sample(s, norm) == [] for s in data[:50]))
print(f"data ready ({time.time()-t0:.1f}s): train {len(train_s)}, val {len(val_s)}")

d = args.d_model
cfg = ModelConfig(grid_p=tuple(float(p) for p in grid), n_field_channels=N_FIELD_CHANNELS, n_static_channels=N_STATIC,
                  n_history=N_HIST, d_model=d, n_latent=4 if d <= 64 else 8, n_heads=4, n_obs_layers=1 if d <= 64 else 2,
                  n_dec_layers=1 if d <= 64 else 2, enc_channels=(32, 48, 64) if d <= 64 else (64, 96, 128))
torch.manual_seed(args.seed)
model = V1SoundingModel(cfg)
print(f"model: {sum(p.numel() for p in model.parameters())/1e6:.2f}M parameters")
batch = to_device(next(iter(make_loader(train_s, 8, shuffle=False))), "cpu")
B, N = 8, len(grid)

# ---- forward pass
out = model(batch)
check("output shapes", out["mean"].shape == (B, 5, N) and out["scale"].shape == (B, 5, N) and out["s_mean"].shape == (B, 5) and out["s_scale"].shape == (B, 5))
check("outputs finite and scale > 0", all(torch.isfinite(v).all() for v in out.values()) and bool((out["scale"] > 0).all()))
check("untrained model equals the teacher prior (zero-initialised residual heads)",
      float((out["mean"] - batch["teacher_profile"]).abs().max()) < 1e-6 and float((out["s_mean"] - batch["teacher_surface"]).abs().max()) < 1e-6)
nb = dict(batch, tok_mask=torch.zeros_like(batch["tok_mask"]))
check("sample with NO observations gives finite output (null token)", all(torch.isfinite(v).all() for v in model(nb).values()))

# ---- losses: masking and gradient flow
w_all = dict(teacher=1.0, obs=0.5, grad=0.3, phys=0.05, unc=0.1, alpha=1.0)
lcfg = LossConfig()
l0, p0 = total_loss(out, batch, w_all, lcfg, norm_t)
bad = dict(batch)
below = ~batch["valid"][:, None, :]
bad["target_profile"] = torch.where(below.expand(-1, 5, -1), batch["target_profile"] + 50.0, batch["target_profile"])
bad["obs_target"] = torch.where(below.expand(-1, 5, -1), batch["obs_target"] + 50.0, batch["obs_target"])
l1, _ = total_loss(out, bad, w_all, lcfg, norm_t)
check("losses ignore below-ground levels", abs(float(l0) - float(l1)) < 1e-4 * max(1.0, abs(float(l0))), f"{float(l0):.5f} vs {float(l1):.5f}"
      + ("" if not batch["valid"].all() else " (no elevated-terrain sample in this batch: weak check)"))
check("all loss terms finite", all(np.isfinite(v) for v in p0.values()), str({k: round(v, 4) for k, v in p0.items()}))

opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
for _ in range(3):                                       # zero-init heads block upstream gradients at step 0 only
    o = model(batch); l, _ = total_loss(o, batch, w_all, lcfg, norm_t); opt.zero_grad(); l.backward(); opt.step()
o = model(batch); l, _ = total_loss(o, batch, w_all, lcfg, norm_t); opt.zero_grad(); l.backward()
none = [n for n, p in model.named_parameters() if p.grad is None]
nonfin = [n for n, p in model.named_parameters() if p.grad is not None and not torch.isfinite(p.grad).all()]
zero = [n for n, p in model.named_parameters() if p.grad is not None and float(p.grad.abs().sum()) == 0.0]
check("gradients reach every parameter and are finite", not none and not nonfin, f"missing={none[:4]} nonfinite={nonfin[:4]}")
if zero: print(f"      note: {len(zero)} parameter tensors have exactly-zero gradient this step, e.g. {zero[:3]}")

# ---- training
torch.manual_seed(args.seed)
out_dir = args.out_dir or tempfile.mkdtemp(prefix="skywatch_smoke_")
tcfg = TrainConfig(steps=args.steps, batch_size=args.batch_size, lr=args.lr, warmup=min(50, args.steps // 5),
                   eval_every=max(args.steps // 4, 1), log_every=max(args.steps // 10, 1), ema_decay=0.99,
                   seed=args.seed, out_dir=out_dir, dataset_version="synthetic-smoke")
model2, hist = train(cfg, tcfg, ScheduleConfig(), train_s, val_s, norm)
check("training produced finite losses throughout", all(np.isfinite(h["total"]) for h in hist), f"{len(hist)} steps recorded")
check("gradient norms stayed finite", all(np.isfinite(h["grad_norm"]) for h in hist))
qv = quick_val(model2, val_s, "cpu")
check("trained model is not worse than the teacher prior (val MAE)", qv["mae_model"] <= 1.10 * qv["mae_prior"], f"{qv['mae_model']:.4f} vs prior {qv['mae_prior']:.4f}")
ratio = qv["mae_model_obs_cells"] / max(qv["mae_prior_obs_cells"], 1e-9)
check("model beats the teacher where observations exist (learning signal)", ratio < 0.97,
      f"obs-covered-cell MAE {qv['mae_model_obs_cells']:.4f} vs prior {qv['mae_prior_obs_cells']:.4f} (ratio {ratio:.3f}; synthetic oracle headroom ~0.58)", hard=args.strict)

# ---- engine + baselines
res = run_evaluation(model2, train_s, val_s, norm, "cpu", hemisphere="S")
check("deterministic engine ingests every predicted column", res["V1_model"]["engine_failure_rate"] == 0.0,
      f"fallback-to-hydrostatic-Z rate {res['V1_model']['engine_fallback_rate']:.2f}")
print("\nModel vs baselines (synthetic validation set, engine-derived metrics):")
print(format_table(res))
print("\nV1 exit criteria on this synthetic set (informational):")
for k, v in check_targets(res["V1_model"]).items():
    print(f"  {k:24s} {v['value']:8.3f} {v['op']} {v['target']:<6} {'ok' if v['passed'] else '--'}")

# ---- checkpoint round trip
ck_path = os.path.join(out_dir, "ckpt.pt")
m3, norm3, ck = load_checkpoint(ck_path, "cpu")
a, b = predict(model2, val_s[:16], "cpu"), predict(m3, val_s[:16], "cpu")
check("checkpoint round-trip reproduces predictions", np.allclose(a["mean"], b["mean"], atol=1e-5) and ck["dataset_version"] == "synthetic-smoke")

hard_fail = [n for n, ok, hard in results if hard and not ok]
print(f"\n{'SMOKE TEST PASSED' if not hard_fail else 'SMOKE TEST FAILED: ' + '; '.join(hard_fail)}  ({len(results)} checks, {time.time()-t0:.0f}s, run dir {out_dir})")
sys.exit(1 if hard_fail else 0)
