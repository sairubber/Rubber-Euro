"""Keyless FRED series — the St. Louis Fed's fredgraph.csv endpoint serves
any public series as plain CSV without an API key.

Used for the desk's macro context:
- DCOILBRENTEU: daily Brent — the crude leg of the NR/synthetic-rubber
  substitution watch (synthetic rubber is made from crude derivatives, so
  crude sets the substitution economics even on an NR-only desk).
- TSIFRGHT: monthly US Freight Transportation Services Index — a free proxy
  for truck-tire wear-and-replacement demand.
"""

from __future__ import annotations

import csv
import io
import logging
import time

from app.netutil import get_retry

logger = logging.getLogger("market_intel")

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"

_cache: dict[str, tuple[float, list[dict]]] = {}
_TTL = 6 * 3600


def fred_series(series_id: str, max_points: int = 600) -> list[dict]:
    """[{date, value}] oldest → newest; missing values ('.') skipped."""
    cached_at, cached = _cache.get(series_id, (0.0, []))
    if cached and time.time() - cached_at < _TTL:
        return cached
    try:
        resp = get_retry(FRED_CSV.format(series=series_id), timeout=30, follow_redirects=True)
        rows = []
        for rec in csv.reader(io.StringIO(resp.text)):
            if len(rec) != 2 or rec[0] == "observation_date" or rec[1] in (".", ""):
                continue
            try:
                rows.append({"date": rec[0], "value": float(rec[1])})
            except ValueError:
                continue
        rows = rows[-max_points:]
        if rows:
            _cache[series_id] = (time.time(), rows)
        return rows
    except Exception:
        logger.exception("FRED fetch failed for %s — serving cache", series_id)
        return cached
