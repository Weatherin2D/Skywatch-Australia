"""V1 sounding network (01_ARCHITECTURE s2-7, 03_V1_SOUNDING_MODEL).

  gridded teacher history ──► SpatialEncoder ─┐
  static geography ─────────► GeoEncoder ─────┼─► TemporalEncoder ─► atmosphere vector ─┐
  teacher column prior ─────► MLP ────────────┘                                         ├─► K latent state tokens
  observation tokens ──► ObsEncoder ──► cross-attention (Perceiver-style) ◄──────────────┘
  vertical queries (ln p, height above ground, prior) ─► decoder (cross+self attention) ─► dilated vertical convs
        ─► heads: Gaussian (mean, scale) for T, ln q, u, v, Z on the internal grid  +  surface head

The mean is a RESIDUAL on the teacher prior (heads zero-initialised: the untrained model equals baseline B), so the
net learns how observations and structure correct the teacher. q is modelled as ln q, hence q > 0 by construction.
Uncertainty is a heteroscedastic Gaussian scale per variable and level (V5 will add coherent latent sampling).
NOT YET RUN in the authoring environment (no torch there) - run scripts/smoke_test.py first.
"""
from __future__ import annotations
import math
from dataclasses import dataclass, asdict
from typing import Dict, Tuple
import torch
import torch.nn as nn
import torch.nn.functional as F

N_PROFILE_VARS = 5
N_SURFACE_VARS = 5
N_FOURIER = 6


@dataclass
class ModelConfig:
    grid_p: Tuple[float, ...]
    n_field_channels: int = 74
    n_static_channels: int = 8
    n_history: int = 3
    n_token_vars: int = 12
    n_sources: int = 5
    n_token_feats: int = 8
    d_model: int = 128
    n_latent: int = 8
    n_heads: int = 4
    n_obs_layers: int = 2
    n_dec_layers: int = 2
    enc_channels: Tuple[int, ...] = (64, 96, 128)      # each must be divisible by 8 (GroupNorm)
    min_scale: float = 0.02
    init_scale: float = 0.3
    dropout: float = 0.0

    def to_dict(self):
        d = asdict(self)
        d["grid_p"], d["enc_channels"] = list(self.grid_p), list(self.enc_channels)
        return d

    @classmethod
    def from_dict(cls, d):
        d = dict(d)
        d["grid_p"], d["enc_channels"] = tuple(d["grid_p"]), tuple(d["enc_channels"])
        return cls(**d)


def _inv_softplus(y: float) -> float:
    return math.log(math.expm1(y))


class ConvBlock(nn.Module):
    def __init__(self, cin: int, cout: int, stride: int):
        super().__init__()
        self.c1 = nn.Conv2d(cin, cout, 3, stride, 1)
        self.n1 = nn.GroupNorm(8, cout)
        self.c2 = nn.Conv2d(cout, cout, 3, 1, 1)
        self.n2 = nn.GroupNorm(8, cout)
        self.skip = nn.Identity() if (cin == cout and stride == 1) else nn.Conv2d(cin, cout, 1, stride)

    def forward(self, x):
        h = F.gelu(self.n1(self.c1(x)))
        h = self.n2(self.c2(h))
        return F.gelu(h + self.skip(x))


class SpatialEncoder(nn.Module):
    """(B,C,H,W) -> (B,d): centre-pixel features (the target column) + global context."""

    def __init__(self, cin: int, channels: Tuple[int, ...], d_model: int):
        super().__init__()
        self.stem = nn.Sequential(nn.Conv2d(cin, channels[0], 3, 1, 1), nn.GroupNorm(8, channels[0]), nn.GELU())
        blocks, c = [], channels[0]
        for c_next in channels[1:]:
            blocks.append(ConvBlock(c, c_next, 2))
            c = c_next
        blocks.append(ConvBlock(c, c, 1))
        self.blocks = nn.Sequential(*blocks)
        self.proj = nn.Linear(2 * c, d_model)

    def forward(self, x):
        h = self.blocks(self.stem(x))
        center = h[:, :, h.shape[2] // 2, h.shape[3] // 2]
        return self.proj(torch.cat([center, h.mean(dim=(2, 3))], dim=1))


class GeoEncoder(nn.Module):
    """Static geography encoded separately and fused later (01 s5)."""

    def __init__(self, cin: int, d_model: int):
        super().__init__()
        self.net = nn.Sequential(nn.Conv2d(cin, 32, 3, 1, 1), nn.GELU(), nn.Conv2d(32, 64, 3, 2, 1), nn.GELU())
        self.proj = nn.Linear(128, d_model)

    def forward(self, x):
        h = self.net(x)
        return self.proj(torch.cat([h[:, :, h.shape[2] // 2, h.shape[3] // 2], h.mean(dim=(2, 3))], dim=1))


class FFN(nn.Module):
    def __init__(self, d: int, dropout: float, mult: int = 2):
        super().__init__()
        self.net = nn.Sequential(nn.LayerNorm(d), nn.Linear(d, mult * d), nn.GELU(), nn.Dropout(dropout), nn.Linear(mult * d, d))

    def forward(self, x):
        return x + self.net(x)


class AttnBlock(nn.Module):
    """Pre-LN residual attention. key_padding_mask: True = ignore that key."""

    def __init__(self, d: int, heads: int, dropout: float):
        super().__init__()
        self.nq, self.nkv = nn.LayerNorm(d), nn.LayerNorm(d)
        self.attn = nn.MultiheadAttention(d, heads, dropout=dropout, batch_first=True)

    def forward(self, q, kv, key_padding_mask=None):
        k = self.nkv(kv)
        out, _ = self.attn(self.nq(q), k, k, key_padding_mask=key_padding_mask, need_weights=False)
        return q + out


class LatentLayer(nn.Module):
    """State tokens read the observations, then mix among themselves."""

    def __init__(self, d, heads, dropout):
        super().__init__()
        self.cross, self.ff1 = AttnBlock(d, heads, dropout), FFN(d, dropout)
        self.selfa, self.ff2 = AttnBlock(d, heads, dropout), FFN(d, dropout)

    def forward(self, s, obs, obs_pad):
        s = self.ff1(self.cross(s, obs, obs_pad))
        return self.ff2(self.selfa(s, s))


class DecoderLayer(nn.Module):
    """Level queries read the latent state, then exchange information along the column."""

    def __init__(self, d, heads, dropout):
        super().__init__()
        self.cross, self.selfa, self.ff = AttnBlock(d, heads, dropout), AttnBlock(d, heads, dropout), FFN(d, dropout)

    def forward(self, q, lat):
        q = self.cross(q, lat)
        q = self.selfa(q, q)
        return self.ff(q)


class VerticalConv(nn.Module):
    """Dilated residual 1-D convolutions along the column: local vertical structure (inversions, jets)."""

    def __init__(self, d: int, dilations=(1, 2, 4)):
        super().__init__()
        self.convs = nn.ModuleList([nn.Conv1d(d, d, 5, padding=2 * k, dilation=k) for k in dilations])
        self.norms = nn.ModuleList([nn.GroupNorm(1, d) for _ in dilations])

    def forward(self, x):                                   # (B,N,d)
        h = x.transpose(1, 2)
        for conv, norm in zip(self.convs, self.norms):
            h = h + conv(F.gelu(norm(h)))
        return h.transpose(1, 2)


class ObsEncoder(nn.Module):
    """Tokens -> embeddings of variable, source, value, uncertainty, quality, position, time (01 s2.1).
    A learned null token is always present so a sample with NO observations never produces NaN attention."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        d = cfg.d_model
        self.var_emb = nn.Embedding(cfg.n_token_vars, d)
        self.src_emb = nn.Embedding(cfg.n_sources, d)
        self.feat = nn.Sequential(nn.Linear(cfg.n_token_feats, d), nn.GELU(), nn.Linear(d, d))
        self.null = nn.Parameter(torch.randn(1, 1, d) * 0.02)
        self.norm = nn.LayerNorm(d)

    def forward(self, var, src, feat, mask):
        tok = self.norm(self.var_emb(var) + self.src_emb(src) + self.feat(feat))
        B = tok.shape[0]
        tok = torch.cat([self.null.expand(B, -1, -1), tok], dim=1)
        pad = torch.cat([torch.zeros(B, 1, dtype=torch.bool, device=mask.device), ~mask], dim=1)
        return tok, pad


class V1SoundingModel(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.cfg = cfg
        d, N = cfg.d_model, len(cfg.grid_p)
        grid = torch.tensor(cfg.grid_p, dtype=torch.float32)
        self.register_buffer("grid_p", grid)
        self.register_buffer("lnp_norm", (torch.log(grid) - 6.3) / 0.7)
        self.register_buffer("freqs", torch.tensor([(2.0 ** k) * math.pi for k in range(N_FOURIER)]))

        self.spatial = SpatialEncoder(cfg.n_field_channels, cfg.enc_channels, d)
        self.geo = GeoEncoder(cfg.n_static_channels, d)
        self.time_fuse = nn.Linear(2 * d, d)
        self.time_pos = nn.Parameter(torch.randn(cfg.n_history, d) * 0.02)
        self.temporal = nn.TransformerEncoder(
            nn.TransformerEncoderLayer(d, cfg.n_heads, 2 * d, cfg.dropout, activation="gelu", batch_first=True, norm_first=True),
            num_layers=1, enable_nested_tensor=False)
        self.prior_mlp = nn.Sequential(nn.Linear(N_PROFILE_VARS * N + N_SURFACE_VARS, d), nn.GELU(), nn.Linear(d, d))
        self.latent_q = nn.Parameter(torch.randn(cfg.n_latent, d) * 0.02)

        self.obs_enc = ObsEncoder(cfg)
        self.latent_layers = nn.ModuleList([LatentLayer(d, cfg.n_heads, cfg.dropout) for _ in range(cfg.n_obs_layers)])

        n_q = 1 + 2 * N_FOURIER + 1 + 1 + N_PROFILE_VARS            # ln p, fourier, ln(p/psfc), valid, prior values
        self.query_mlp = nn.Sequential(nn.Linear(n_q, d), nn.GELU(), nn.Linear(d, d))
        self.dec_layers = nn.ModuleList([DecoderLayer(d, cfg.n_heads, cfg.dropout) for _ in range(cfg.n_dec_layers)])
        self.vconv = VerticalConv(d)
        self.head = nn.Linear(d, 2 * N_PROFILE_VARS)
        self.surf_head = nn.Sequential(nn.Linear(d + N_SURFACE_VARS, d), nn.GELU(), nn.Linear(d, 2 * N_SURFACE_VARS))
        self._init_heads()

    def _init_heads(self):
        bias = _inv_softplus(self.cfg.init_scale - self.cfg.min_scale)
        with torch.no_grad():
            self.head.weight[:N_PROFILE_VARS].zero_(); self.head.bias[:N_PROFILE_VARS].zero_()      # mean residual = 0
            self.head.bias[N_PROFILE_VARS:].fill_(bias)
            last = self.surf_head[-1]
            last.weight[:N_SURFACE_VARS].zero_(); last.bias[:N_SURFACE_VARS].zero_()
            last.bias[N_SURFACE_VARS:].fill_(bias)

    def _fourier(self, x):                                     # (B,N) -> (B,N,2*N_FOURIER)
        ang = x[..., None] * self.freqs
        return torch.cat([torch.sin(ang), torch.cos(ang)], dim=-1)

    def forward(self, b: Dict[str, torch.Tensor]) -> Dict[str, torch.Tensor]:
        fields = b["fields"]                                   # (B,T,C,H,W)
        B, T, C, H, W = fields.shape
        sp = self.spatial(fields.reshape(B * T, C, H, W)).reshape(B, T, -1)
        geo = self.geo(b["static"])
        x = self.time_fuse(torch.cat([sp, geo[:, None, :].expand(-1, T, -1)], dim=-1)) + self.time_pos[:T]
        x = self.temporal(x)[:, -1]                            # (B,d) state at t0

        prior = b["teacher_profile"]                           # (B,5,N) normalised
        prior_s = b["teacher_surface"]                         # (B,5)
        pv = self.prior_mlp(torch.cat([prior.flatten(1), prior_s], dim=1))
        lat = self.latent_q[None] + (x + pv)[:, None, :]       # (B,K,d)

        obs, pad = self.obs_enc(b["tok_var"], b["tok_src"], b["tok_feat"], b["tok_mask"])
        for layer in self.latent_layers:
            lat = layer(lat, obs, pad)

        p_sfc = b["p_sfc_prior"]
        lnp = self.lnp_norm[None, :].expand(B, -1)
        valid = (self.grid_p[None, :] <= p_sfc[:, None]).to(lnp.dtype)
        rel = torch.log(self.grid_p[None, :] / p_sfc[:, None]) / 0.5
        qf = torch.cat([lnp[..., None], self._fourier(lnp), rel[..., None], valid[..., None], prior.transpose(1, 2)], dim=-1)
        q = self.query_mlp(qf)
        for layer in self.dec_layers:
            q = layer(q, lat)
        out = self.head(self.vconv(q))                         # (B,N,10)
        mean = prior + out[..., :N_PROFILE_VARS].transpose(1, 2)
        scale = F.softplus(out[..., N_PROFILE_VARS:]).transpose(1, 2) + self.cfg.min_scale

        so = self.surf_head(torch.cat([lat.mean(dim=1), prior_s], dim=-1))
        return dict(mean=mean, scale=scale, s_mean=prior_s + so[:, :N_SURFACE_VARS],
                    s_scale=F.softplus(so[:, N_SURFACE_VARS:]) + self.cfg.min_scale)
