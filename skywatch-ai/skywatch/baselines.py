"""Milestone 3: baselines A-D (03 s24). All operate on batch dicts (see contract.py) in normalised space and
return (profile (B,5,N), surface (B,5)). D uses ONLY teacher inputs (no observations), by design."""
from __future__ import annotations
import numpy as np


def predict_A(b):
    """A: nearest teacher grid point."""
    return b["teacher_nearest"].copy(), b["teacher_surface"].copy()


def predict_B(b):
    """B: bilinear/ln-p interpolated teacher at the target (what the pipeline hands the model as prior)."""
    return b["teacher_profile"].copy(), b["teacher_surface"].copy()


def predict_C(b):
    """C: persistence of the previous sounding where one exists, else teacher."""
    use = b["persistence_valid"].astype(bool)
    prof = np.where(use[:, None, None], b["persistence_profile"], b["teacher_profile"])
    surf = np.where(use[:, None], b["persistence_surface"], b["teacher_surface"])
    return prof, surf


class RidgeBaseline:
    """D: ridge regression of (target - teacher) on the teacher column + surface. Closed form."""

    def __init__(self, lam: float = 30.0):
        self.lam, self.W = lam, None

    @staticmethod
    def _x(b):
        v = b["valid"][:, None, :]
        B = b["teacher_profile"].shape[0]
        return np.concatenate([(b["teacher_profile"] * v).reshape(B, -1), b["teacher_surface"], np.ones((B, 1))], 1).astype(float)

    def fit(self, b):
        X = self._x(b)
        v = b["valid"][:, None, :]
        B = X.shape[0]
        Y = np.concatenate([((b["target_profile"] - b["teacher_profile"]) * v).reshape(B, -1),
                            b["target_surface"] - b["teacher_surface"]], 1).astype(float)
        self.W = np.linalg.solve(X.T @ X + self.lam * np.eye(X.shape[1]), X.T @ Y)
        return self

    def predict(self, b):
        X = self._x(b)
        B, V, N = b["teacher_profile"].shape
        R = X @ self.W
        prof = b["teacher_profile"] + np.where(b["valid"][:, None, :], R[:, :V * N].reshape(B, V, N), 0.0)
        return prof.astype(np.float32), (b["teacher_surface"] + R[:, V * N:]).astype(np.float32)


BASELINES = {"A_nearest": predict_A, "B_interp": predict_B, "C_persistence": predict_C}
