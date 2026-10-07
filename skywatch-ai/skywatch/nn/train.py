"""Training loop, evaluation against baselines, checkpointing. Run `scripts/smoke_test.py` first."""
from __future__ import annotations
import copy
import json
import math
import os
import time
from dataclasses import dataclass, asdict, replace
from typing import Dict, List, Optional
import numpy as np
import torch

from .. import baselines as bl
from ..evaluate import evaluate_batch, check_targets
from ..normalizer import Normalizer
from ..synthetic import stack
from .data import make_loader, to_device
from .losses import LossConfig, TorchNormalizer, total_loss
from .model import ModelConfig, V1SoundingModel
from .schedule import LossSchedule, ScheduleConfig


@dataclass
class TrainConfig:
    steps: int = 2000
    batch_size: int = 32
    lr: float = 2e-4
    weight_decay: float = 0.01
    warmup: int = 100
    grad_clip: float = 1.0
    eval_every: int = 250
    log_every: int = 25
    ema_decay: float = 0.999
    device: str = "auto"
    seed: int = 0
    out_dir: str = "runs/v1"
    dataset_version: str = "unversioned"      # 02 s26: every run records the dataset version it used
    amp: bool = False                         # bf16 autocast on CUDA for the network forward only
    num_workers: int = 0


def pick_device(name: str) -> torch.device:
    if name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(name)


def lr_at(step: int, cfg: TrainConfig, mult: float = 1.0) -> float:
    warm = min(1.0, (step + 1) / max(cfg.warmup, 1))
    cos = 0.1 + 0.9 * 0.5 * (1.0 + math.cos(math.pi * min(1.0, step / max(cfg.steps, 1))))
    return cfg.lr * warm * cos * mult


class EMA:
    def __init__(self, model: torch.nn.Module, decay: float):
        self.decay = decay
        self.shadow = {k: v.detach().clone() for k, v in model.state_dict().items()}

    @torch.no_grad()
    def update(self, model: torch.nn.Module, step: int):
        d = min(self.decay, (1.0 + step) / (10.0 + step))
        for k, v in model.state_dict().items():
            if v.dtype.is_floating_point:
                self.shadow[k].mul_(d).add_(v.detach(), alpha=1.0 - d)
            else:
                self.shadow[k].copy_(v)

    def model_copy(self, model: torch.nn.Module) -> torch.nn.Module:
        m = copy.deepcopy(model)
        m.load_state_dict(self.shadow)
        return m.eval()


@torch.no_grad()
def predict(model, samples, device, batch_size: int = 64) -> Dict[str, np.ndarray]:
    model.eval()
    outs = {"mean": [], "scale": [], "s_mean": [], "s_scale": []}
    for b in make_loader(samples, batch_size, shuffle=False):
        o = model(to_device(b, device))
        for k in outs:
            outs[k].append(o[k].float().cpu().numpy())
    return {k: np.concatenate(v) for k, v in outs.items()}


@torch.no_grad()
def quick_val(model, samples, device, batch_size: int = 64) -> Dict[str, float]:
    """Cheap normalised-space MAE of model vs. the teacher prior (baseline B), overall and on observation-covered cells."""
    model.eval()
    s = dict(m=0.0, p=0.0, n=0.0, mo=0.0, po=0.0, no=0.0)
    for b in make_loader(samples, batch_size, shuffle=False):
        b = to_device(b, device)
        o = model(b)
        valid = b["valid"][:, None, :].float().expand(-1, 5, -1)
        cov = (b["obs_mask"] & b["valid"][:, None, :]).float()
        em, ep = (o["mean"] - b["target_profile"]).abs(), (b["teacher_profile"] - b["target_profile"]).abs()
        s["m"] += float((em * valid).sum()); s["p"] += float((ep * valid).sum()); s["n"] += float(valid.sum())
        s["mo"] += float((em * cov).sum()); s["po"] += float((ep * cov).sum()); s["no"] += float(cov.sum())
    return dict(mae_model=s["m"] / max(s["n"], 1), mae_prior=s["p"] / max(s["n"], 1),
                mae_model_obs_cells=s["mo"] / max(s["no"], 1), mae_prior_obs_cells=s["po"] / max(s["no"], 1))


def run_evaluation(model, train_samples, val_samples, norm: Normalizer, device, hemisphere: str = "S") -> Dict[str, Dict[str, float]]:
    """Model and baselines A-D scored identically through the deterministic engine (03 s24-26)."""
    vb = stack(val_samples)
    pred = predict(model, val_samples, device)
    kw = dict(truth_prof=vb["target_profile"], truth_surf=vb["target_surface"], valid=vb["valid"], z_sfc=vb["z_sfc"], hemisphere=hemisphere)
    res = {"V1_model": evaluate_batch(norm, pred["mean"], pred["s_mean"], kw["truth_prof"], kw["truth_surf"], kw["valid"], kw["z_sfc"],
                                      pred_sigma=pred["scale"], hemisphere=hemisphere)}
    for name, fn in bl.BASELINES.items():
        p, s = fn(vb)
        res[name] = evaluate_batch(norm, p, s, kw["truth_prof"], kw["truth_surf"], kw["valid"], kw["z_sfc"], hemisphere=hemisphere)
    ridge = bl.RidgeBaseline().fit(stack(train_samples))
    p, s = ridge.predict(vb)
    res["D_ridge"] = evaluate_batch(norm, p, s, kw["truth_prof"], kw["truth_surf"], kw["valid"], kw["z_sfc"], hemisphere=hemisphere)
    return res


def format_table(res: Dict[str, Dict[str, float]]) -> str:
    cols = ["T_rmse_K", "vector_wind_rmse_ms", "cape_corr", "high_cape_mae", "inversion_hit_rate",
            "artificial_cape_rate", "inversion_false_alarm_rate", "mae_shear_0_6km", "mae_srh_0_3km", "coverage_80"]
    head = f"{'':16s}" + "".join(f"{c[:15]:>16s}" for c in cols)
    lines = [head]
    for name, m in res.items():
        lines.append(f"{name:16s}" + "".join(f"{m.get(c, float('nan')):16.3f}" for c in cols))
    return "\n".join(lines)


def save_checkpoint(path, model, ema_model, model_cfg, tcfg, scfg, norm, step, history):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    torch.save(dict(model=model.state_dict(), ema=ema_model.state_dict(), model_cfg=model_cfg.to_dict(),
                    train_cfg=asdict(tcfg), schedule_cfg=asdict(scfg), norm=norm.to_dict(), step=step,
                    dataset_version=tcfg.dataset_version, history=history[-200:]), path)


def load_checkpoint(path, device="cpu", use_ema: bool = True):
    ck = torch.load(path, map_location=device, weights_only=False)
    model = V1SoundingModel(ModelConfig.from_dict(ck["model_cfg"]))
    model.load_state_dict(ck["ema" if use_ema else "model"])
    return model.to(device).eval(), Normalizer.from_dict(ck["norm"]), ck


def train(model_cfg: ModelConfig, tcfg: TrainConfig, scfg: ScheduleConfig, train_samples, val_samples, norm: Normalizer,
          loss_cfg: Optional[LossConfig] = None, log=print):
    torch.manual_seed(tcfg.seed); np.random.seed(tcfg.seed)
    device = pick_device(tcfg.device)
    loss_cfg = loss_cfg or LossConfig()
    scfg = replace(scfg, total_steps=tcfg.steps)
    schedule = LossSchedule(scfg)
    model = V1SoundingModel(model_cfg).to(device)
    norm_t = TorchNormalizer(norm).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=tcfg.lr, weight_decay=tcfg.weight_decay, betas=(0.9, 0.95))
    ema = EMA(model, tcfg.ema_decay)
    os.makedirs(tcfg.out_dir, exist_ok=True)
    log_path = os.path.join(tcfg.out_dir, "log.jsonl")
    n_params = sum(p.numel() for p in model.parameters())
    log(f"device={device} params={n_params/1e6:.2f}M train={len(train_samples)} val={len(val_samples)} dataset={tcfg.dataset_version}")

    if len(train_samples) < tcfg.batch_size:
        raise ValueError("need at least one full batch of training samples")

    def loader(events: bool):
        epoch = 0
        while True:                                   # deterministic given tcfg.seed
            for b in make_loader(train_samples, tcfg.batch_size, shuffle=True, event_oversample=events,
                                 seed=tcfg.seed + epoch, num_workers=tcfg.num_workers):
                yield b
            epoch += 1
    it, events_on = loader(False), False
    history: List[dict] = []
    skipped = consecutive_skips = 0
    t0 = time.time()
    for step in range(tcfg.steps):
        w = schedule.weights(step)
        if w["event_finetune"] and not events_on:
            it, events_on = loader(True), True
            log(f"step {step}: stage 6 - event fine-tuning (event-oversampled batches, lr x{w['lr_mult']})")
        batch = to_device(next(it), device)
        for g in opt.param_groups:
            g["lr"] = lr_at(step, tcfg, w["lr_mult"])
        model.train()
        with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=bool(tcfg.amp and device.type == "cuda")):
            out = model(batch)
        out = {k: v.float() for k, v in out.items()}
        loss, parts = total_loss(out, batch, w, loss_cfg, norm_t)
        if not torch.isfinite(loss):
            skipped += 1; consecutive_skips += 1
            log(f"step {step}: non-finite loss, step skipped ({skipped} total)")
            if consecutive_skips > 20:
                raise RuntimeError("20 consecutive non-finite losses; aborting")
            opt.zero_grad(set_to_none=True)
            continue
        consecutive_skips = 0
        opt.zero_grad(set_to_none=True)
        loss.backward()
        gn = float(torch.nn.utils.clip_grad_norm_(model.parameters(), tcfg.grad_clip))
        opt.step()
        ema.update(model, step)
        rec = dict(step=step, stage=w["stage"], lr=opt.param_groups[0]["lr"], grad_norm=gn, **parts)
        history.append(rec)
        if step % tcfg.log_every == 0 or step == tcfg.steps - 1:
            log(f"step {step:5d} [{w['stage']:14s}] total {parts['total']:.4f} teacher {parts['teacher']:.4f} obs {parts['obs']:.4f} "
                f"grad {parts['grad']:.4f} phys {parts['phys']:.4f} unc {parts['unc']:.4f} |g| {gn:.2f} ({time.time()-t0:.0f}s)")
            with open(log_path, "a") as f:
                f.write(json.dumps(rec) + "\n")
        if (step + 1) % tcfg.eval_every == 0 or step == tcfg.steps - 1:
            qv = quick_val(ema.model_copy(model).to(device), val_samples, device)
            log(f"  val (EMA) MAE model {qv['mae_model']:.4f} vs prior {qv['mae_prior']:.4f} | obs-covered cells {qv['mae_model_obs_cells']:.4f} vs {qv['mae_prior_obs_cells']:.4f}")
            with open(log_path, "a") as f:
                f.write(json.dumps(dict(step=step, val=qv)) + "\n")
            save_checkpoint(os.path.join(tcfg.out_dir, "ckpt.pt"), model, ema.model_copy(model), model_cfg, tcfg, scfg, norm, step, history)
    final = ema.model_copy(model).to(device)
    return final, history
