from __future__ import annotations
from typing import Dict, List
import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler


class SampleDataset(Dataset):
    """Wraps a list of sample dicts (see skywatch/contract.py)."""

    def __init__(self, samples: List[Dict[str, np.ndarray]]):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, i):
        return {k: torch.as_tensor(np.asarray(v)) for k, v in self.samples[i].items()}


def collate(items):
    return {k: torch.stack([it[k] for it in items]) for k in items[0]}


def to_device(batch, device):
    return {k: v.to(device) for k, v in batch.items()}


def make_loader(samples, batch_size: int, shuffle: bool, event_oversample: bool = False, seed: int = 0, num_workers: int = 0):
    """event_oversample: draw samples proportionally to `event_weight` (stage-6 event fine-tuning, 02 s24)."""
    ds = SampleDataset(samples)
    if event_oversample:
        w = torch.tensor([float(s["event_weight"]) for s in samples], dtype=torch.double)
        g = torch.Generator().manual_seed(seed)
        sampler = WeightedRandomSampler(w, num_samples=len(samples), replacement=True, generator=g)
        return DataLoader(ds, batch_size=batch_size, sampler=sampler, collate_fn=collate, num_workers=num_workers, drop_last=True)
    g = torch.Generator().manual_seed(seed)
    return DataLoader(ds, batch_size=batch_size, shuffle=shuffle, collate_fn=collate, num_workers=num_workers,
                      drop_last=shuffle, generator=g if shuffle else None)
