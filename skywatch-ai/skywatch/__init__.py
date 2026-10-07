"""SkyWatch AI - V1 sounding model package.

Contract (01_ARCHITECTURE s10): the neural network predicts atmospheric state;
this package's deterministic engine derives every meteorological diagnostic.
"""
from .profile import Profile
from .diagnostics import compute_diagnostics, compute_batch

__all__ = ["Profile", "compute_diagnostics", "compute_batch"]
__version__ = "0.1.0"
