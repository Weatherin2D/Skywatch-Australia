"""Staged loss schedule (03 s34): teacher -> observation anchoring -> structure -> physics -> probabilistic
-> event fine-tune. Pure python (no torch)."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict

STAGES = ("teacher", "obs_anchor", "structure", "physics", "probabilistic", "event_finetune")


@dataclass
class ScheduleConfig:
    total_steps: int = 10000
    boundaries: tuple = (0.0, 0.25, 0.45, 0.60, 0.75, 0.90)    # stage start, as fractions of total_steps
    final: Dict[str, float] = field(default_factory=lambda: dict(obs=0.5, grad=0.3, phys=0.05, unc=0.1))
    alpha_start: float = 0.2          # share of CRPS (vs plain MAE) in the teacher/obs terms at the start
    ramp_fraction: float = 0.5        # of each stage's length used to ramp a newly introduced term 0 -> final
    event_lr_mult: float = 0.3


class LossSchedule:
    def __init__(self, cfg: ScheduleConfig):
        self.cfg = cfg

    def _ramp(self, frac: float, stage_idx: int) -> float:
        b = self.cfg.boundaries
        start = b[stage_idx]
        end = b[stage_idx + 1] if stage_idx + 1 < len(b) else 1.0
        span = max((end - start) * self.cfg.ramp_fraction, 1e-9)
        return min(max((frac - start) / span, 0.0), 1.0)

    def weights(self, step: int) -> Dict[str, float]:
        c = self.cfg
        frac = min(max(step / max(c.total_steps, 1), 0.0), 1.0)
        stage = max(i for i, s in enumerate(c.boundaries) if frac >= s)
        return dict(
            stage=STAGES[stage], stage_idx=stage, teacher=1.0,
            obs=c.final["obs"] * self._ramp(frac, 1),
            grad=c.final["grad"] * self._ramp(frac, 2),
            phys=c.final["phys"] * self._ramp(frac, 3),
            unc=c.final["unc"] * self._ramp(frac, 4),
            alpha=c.alpha_start + (1.0 - c.alpha_start) * self._ramp(frac, 4),
            event_finetune=stage >= 5, lr_mult=c.event_lr_mult if stage >= 5 else 1.0)
