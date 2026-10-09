"""Fetch Open-Meteo pressure-level columns as a V1 *teacher prior*.

Live predict → forecast API (`best_match`).
Historical ETL → archive API (ERA5) when a past `time_iso` is given.

Not BARRA2 — bootstrap until local reanalysis NetCDF is wired.
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timedelta, timezone
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np

# Match V1 IN_LEVELS so the teacher prior is not vertically undersampled.
OM_LEVELS = [1000, 950, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100]

# Spatial context for the sounding net (centre cell = target column).
# 0.25° ≈ IFS025 native; override with SKYWATCH_AI_SPATIAL_STEP.
DEFAULT_SPATIAL_STEP_DEG = 0.25
DEFAULT_SPATIAL_WINDOW = 9
_WINDOW_BATCH = 40

MODEL_MAP = {
    "pulse": "best_match",
    "ifs": "ecmwf_ifs025",
    "access": "bom_access_global",
    "gfs": "gfs_seamless",
    "era5": "era5",
}


def _get_json(url: str, timeout: float = 60.0, retries: int = 3) -> dict:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "SkyWatchAI-ETL/0.3"})
            with urlopen(req, timeout=timeout) as res:
                return json.loads(res.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Open-Meteo fetch failed after {retries} tries: {last}")


def _parse_hourly_column(
    hourly: dict,
    times: List[str],
    idx: int,
    lat: float,
    lon: float,
    model: str,
    source: str,
) -> Dict[str, Any]:
    from skywatch import thermo as th
    from skywatch.constants import EPS

    p_list: List[float] = []
    T_list: List[float] = []
    q_list: List[float] = []
    u_list: List[float] = []
    v_list: List[float] = []
    z_list: List[float] = []
    for p in OM_LEVELS:
        tC = (hourly.get(f"temperature_{p}hPa") or [None])[idx]
        rh = (hourly.get(f"relative_humidity_{p}hPa") or [None])[idx]
        u = (hourly.get(f"wind_u_component_{p}hPa") or [None])[idx]
        v = (hourly.get(f"wind_v_component_{p}hPa") or [None])[idx]
        z = (hourly.get(f"geopotential_height_{p}hPa") or [None])[idx]
        if any(
            x is None or (isinstance(x, float) and math.isnan(x))
            for x in (tC, rh, u, v, z)
        ):
            continue
        Tk = float(tC) + 273.15
        es = float(th.sat_vapor_pressure(np.array([Tk]))[0])
        e = max(0.0, min(0.95 * p, (float(rh) / 100.0) * es))
        w = EPS * e / max(p - e, 1e-6)
        q = w / (1.0 + w)
        p_list.append(float(p))
        T_list.append(Tk)
        q_list.append(float(q))
        u_list.append(float(u))
        v_list.append(float(v))
        z_list.append(float(z))

    if len(p_list) < 5:
        raise RuntimeError("Open-Meteo column too short after NaN filter")

    order = np.argsort(-np.asarray(p_list))
    u = np.asarray(u_list, float)[order]
    v = np.asarray(v_list, float)[order]
    # Guard: default Open-Meteo unit is km/h; m/s jets rarely exceed ~120.
    if float(np.nanmax(np.hypot(u, v))) > 150.0:
        raise RuntimeError(
            "Open-Meteo winds look like km/h (max speed > 150); set wind_speed_unit=ms"
        )
    return {
        "p": np.asarray(p_list, float)[order],
        "T": np.asarray(T_list, float)[order],
        "q": np.asarray(q_list, float)[order],
        "u": u,
        "v": v,
        "z": np.asarray(z_list, float)[order],
        "p_sfc": float(np.asarray(p_list, float)[order][0]),
        "valid_time": times[idx] + ("Z" if "Z" not in times[idx] else ""),
        "model": model,
        "source": source,
        "lat": lat,
        "lon": lon,
    }


def _pick_time_index(times: List[str], time_iso: Optional[str]) -> int:
    if not times:
        return 0

    def ts(t: str) -> float:
        return datetime.fromisoformat(t.replace("Z", "")).replace(
            tzinfo=timezone.utc
        ).timestamp()

    # Live calls with no explicit time → nearest hour to now (not the archive start).
    if not time_iso:
        now = datetime.now(timezone.utc).timestamp()
        return min(range(len(times)), key=lambda i: abs(ts(times[i]) - now))

    target = time_iso.replace("Z", "")[:16]
    for i, t in enumerate(times):
        if t[:16] == target[:16]:
            return i
    try:
        tgt = datetime.fromisoformat(target).replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return len(times) - 1

    return min(range(len(times)), key=lambda i: abs(ts(times[i]) - tgt))


def _hourly_vars() -> List[str]:
    vars_: List[str] = []
    for p in OM_LEVELS:
        vars_.extend(
            [
                f"temperature_{p}hPa",
                f"relative_humidity_{p}hPa",
                f"wind_u_component_{p}hPa",
                f"wind_v_component_{p}hPa",
                f"geopotential_height_{p}hPa",
            ]
        )
    return vars_


def _try_parse(data: dict, lat: float, lon: float, model_name: str, source: str, time_iso: Optional[str]):
    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        raise RuntimeError("Open-Meteo returned no hourly data")
    idx = _pick_time_index(times, time_iso)
    return _parse_hourly_column(hourly, times, idx, lat, lon, model_name, source)


def fetch_teacher_column(
    lat: float,
    lon: float,
    *,
    model: str = "pulse",
    time_iso: Optional[str] = None,
    prefer_archive: Optional[bool] = None,
) -> Dict[str, Any]:
    """Return native arrays p,T,q,u,v,z plus meta for one column.

    Past times → historical-forecast API (IFS/GFS pressure levels work).
    Free ERA5 archive often returns nulls for upper-air vars, so it is a
    last resort only. Recent/live → forecast API with past_days.
    """
    vars_ = _hourly_vars()
    m = MODEL_MAP.get(model, model)
    # "era5" on archive is flaky for pressure levels — prefer IFS hist.
    if m == "era5":
        m = "ecmwf_ifs025"

    use_hist = prefer_archive
    if use_hist is None and time_iso:
        try:
            t = datetime.fromisoformat(time_iso.replace("Z", "+00:00")).astimezone(
                timezone.utc
            )
            # Live forecast window is ~past_days+forecast_days; older → hist.
            use_hist = t < datetime.now(timezone.utc) - timedelta(days=2)
        except ValueError:
            use_hist = False

    errors: List[str] = []

    # Open-Meteo defaults wind components to km/h — always request m/s.
    wind_unit = {"wind_speed_unit": "ms"}

    if use_hist and time_iso:
        t = datetime.fromisoformat(time_iso.replace("Z", "+00:00")).astimezone(
            timezone.utc
        )
        day = t.strftime("%Y-%m-%d")
        params = {
            "latitude": f"{lat:.4f}",
            "longitude": f"{lon:.4f}",
            "start_date": day,
            "end_date": day,
            "hourly": ",".join(vars_),
            "timezone": "UTC",
            "models": m,
            **wind_unit,
        }
        url = (
            "https://historical-forecast-api.open-meteo.com/v1/forecast?"
            + urlencode(params)
        )
        try:
            data = _get_json(url)
            return _try_parse(
                data, lat, lon, m, "open-meteo-historical-forecast", time_iso
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"hist:{exc}")

    # Live / near-term forecast (covers past_days).
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "hourly": ",".join(vars_),
        "models": m if m != "era5" else "best_match",
        "timezone": "UTC",
        "forecast_days": "2",
        "past_days": "8",
        **wind_unit,
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urlencode(params)
    try:
        data = _get_json(url)
        return _try_parse(data, lat, lon, m, "open-meteo-forecast", time_iso)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"forecast:{exc}")

    # Last resort: climate archive (often null for pressure levels).
    if time_iso:
        t = datetime.fromisoformat(time_iso.replace("Z", "+00:00")).astimezone(
            timezone.utc
        )
        day = t.strftime("%Y-%m-%d")
        params = {
            "latitude": f"{lat:.4f}",
            "longitude": f"{lon:.4f}",
            "start_date": day,
            "end_date": day,
            "hourly": ",".join(vars_),
            "timezone": "UTC",
            **wind_unit,
        }
        url = "https://archive-api.open-meteo.com/v1/archive?" + urlencode(params)
        try:
            data = _get_json(url)
            return _try_parse(
                data, lat, lon, "era5", "open-meteo-archive-era5", time_iso
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"archive:{exc}")

    raise RuntimeError("Open-Meteo teacher failed: " + " | ".join(errors))


def spatial_step_deg() -> float:
    raw = os.environ.get("SKYWATCH_AI_SPATIAL_STEP", "").strip()
    if raw:
        try:
            step = float(raw)
            if 0.05 <= step <= 1.0:
                return step
        except ValueError:
            pass
    return DEFAULT_SPATIAL_STEP_DEG


def _window_offsets(window: int, step_deg: float) -> List[Tuple[float, float]]:
    mid = window // 2
    out: List[Tuple[float, float]] = []
    for i in range(window):
        for j in range(window):
            out.append(((i - mid) * step_deg, (j - mid) * step_deg))
    return out


def _forecast_batch(
    lats: Sequence[float],
    lons: Sequence[float],
    *,
    model_name: str,
    vars_: List[str],
) -> List[dict]:
    """Multi-point Open-Meteo forecast; returns one hourly payload per site."""
    params = {
        "latitude": ",".join(f"{v:.4f}" for v in lats),
        "longitude": ",".join(f"{v:.4f}" for v in lons),
        "hourly": ",".join(vars_),
        "models": model_name,
        "timezone": "UTC",
        "forecast_days": "2",
        "past_days": "8",
        "wind_speed_unit": "ms",
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urlencode(params)
    data = _get_json(url, timeout=90.0, retries=3)
    rows = data if isinstance(data, list) else [data]
    return rows


def fetch_teacher_window(
    lat: float,
    lon: float,
    *,
    model: str = "pulse",
    time_iso: Optional[str] = None,
    window: int = DEFAULT_SPATIAL_WINDOW,
    step_deg: Optional[float] = None,
    n_hist: int = 3,
) -> Dict[str, Any]:
    """Fetch a real lat/lon neighbourhood of teacher columns for V1 fields.

    Returns centre column plus `history` shaped (n_hist, window, window) of
    column dicts (None where a site failed). Spacing defaults to 0.25°.
    """
    step = float(step_deg if step_deg is not None else spatial_step_deg())
    window = int(window)
    if window < 1 or window % 2 == 0:
        raise ValueError("window must be an odd integer >= 1")
    n_hist = max(1, int(n_hist))

    m = MODEL_MAP.get(model, model)
    if m == "era5":
        m = "ecmwf_ifs025"
    vars_ = _hourly_vars()
    offsets = _window_offsets(window, step)
    sites = [(lat + dlat, lon + dlon) for dlat, dlon in offsets]

    payloads: List[Optional[dict]] = [None] * len(sites)
    for i in range(0, len(sites), _WINDOW_BATCH):
        chunk = sites[i : i + _WINDOW_BATCH]
        try:
            rows = _forecast_batch(
                [s[0] for s in chunk],
                [s[1] for s in chunk],
                model_name=m if m != "era5" else "best_match",
                vars_=vars_,
            )
        except Exception:
            rows = []
        for j, site in enumerate(chunk):
            row = rows[j] if j < len(rows) else None
            payloads[i + j] = row if isinstance(row, dict) else None
        if i + _WINDOW_BATCH < len(sites):
            time.sleep(0.08)

    # Pick a shared time index from the centre site (or first valid).
    mid = window // 2
    centre_payload = payloads[mid * window + mid]
    times: List[str] = []
    if centre_payload:
        times = list((centre_payload.get("hourly") or {}).get("time") or [])
    if not times:
        for row in payloads:
            if not row:
                continue
            times = list((row.get("hourly") or {}).get("time") or [])
            if times:
                break
    if not times:
        # Fall back to single-column fetch (no spatial context).
        centre = fetch_teacher_column(lat, lon, model=model, time_iso=time_iso)
        return {
            "center": centre,
            "history": None,
            "window": window,
            "step_deg": step,
            "spatial": False,
        }

    idx = _pick_time_index(times, time_iso)
    hist_idxs = [max(0, idx - (n_hist - 1 - t)) for t in range(n_hist)]

    history: List[List[List[Optional[Dict[str, Any]]]]] = [
        [[None for _ in range(window)] for _ in range(window)] for _ in range(n_hist)
    ]
    centre: Optional[Dict[str, Any]] = None

    for si, row in enumerate(payloads):
        i, j = divmod(si, window)
        slat, slon = sites[si]
        if not row:
            continue
        hourly = row.get("hourly") or {}
        row_times = list(hourly.get("time") or [])
        if not row_times:
            continue
        for t, ti in enumerate(hist_idxs):
            # Remap index if this site's timeline differs slightly.
            use_i = ti if ti < len(row_times) else _pick_time_index(
                row_times, times[ti] if ti < len(times) else time_iso
            )
            try:
                col = _parse_hourly_column(
                    hourly,
                    row_times,
                    use_i,
                    slat,
                    slon,
                    m,
                    "open-meteo-forecast-window",
                )
            except Exception:
                continue
            history[t][i][j] = col
            if t == n_hist - 1 and i == mid and j == mid:
                centre = col

    if centre is None:
        centre = fetch_teacher_column(lat, lon, model=model, time_iso=time_iso)
        return {
            "center": centre,
            "history": None,
            "window": window,
            "step_deg": step,
            "spatial": False,
        }

    return {
        "center": centre,
        "history": history,
        "window": window,
        "step_deg": step,
        "spatial": True,
        "model": m,
    }
