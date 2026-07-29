"""ENSO state from NOAA's Oceanic Niño Index (ONI).

Source: the CPC's published ONI table (plain text, no key). ONI is the
3-month running mean of ERSST.v5 SST anomalies in the Niño 3.4 region —
the standard El Niño / La Niña yardstick. El Niño tends to bring drought
risk to SE Asian rubber belts; La Niña brings excess-rain tapping loss.
"""

from __future__ import annotations

import logging
import time

import httpx

from app.netutil import get_retry

logger = logging.getLogger("market_intel")

ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"

_cache: tuple[float, dict | None] = (0.0, None)
_TTL = 86400  # updates monthly; a day of cache is plenty


def get_enso_state() -> dict | None:
    """Latest ONI row: {season, year, anomaly, phase}."""
    global _cache
    cached_at, cached = _cache
    if cached and time.time() - cached_at < _TTL:
        return cached
    try:
        resp = get_retry(ONI_URL, timeout=20)
        lines = [ln.split() for ln in resp.text.strip().splitlines() if ln.strip()]
        # rows: SEAS YR TOTAL ANOM — last row is the newest 3-month season
        last = lines[-1]
        anomaly = float(last[3])
        if anomaly >= 0.5:
            phase = "El Niño (warm phase) — drought risk for SE Asian belts"
        elif anomaly <= -0.5:
            phase = "La Niña (cool phase) — excess-rain tapping risk"
        else:
            phase = "Neutral"
        state = {"season": last[0], "year": int(last[1]), "anomaly": anomaly, "phase": phase}
        _cache = (time.time(), state)
        return state
    except Exception:
        logger.exception("ONI fetch failed — serving cached state")
        return cached
