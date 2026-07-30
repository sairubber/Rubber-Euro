"""INE NR (TSR20) daily history + honest cross-exchange spread history.

Sources, both free:
- Sina's daily-kline API for NR0, the INE NR main-contract continuous series
  (same public feed the live Shanghai board uses) — daily settlements back to
  the contract's 2019 launch.
- frankfurter.app (ECB reference rates) for HISTORICAL USD/CNY — each day's
  INE settlement is converted at that day's own rate. Converting history at
  today's rate would silently repaint the past; this module never does that.

Powers: the SGX-vs-INE spread history chart and the multi-year INE NR
seasonality envelope (which is TSR20 data — no sheet-grade proxy needed).
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import date, timedelta

import httpx

from app.netutil import get_retry

logger = logging.getLogger("market_intel")

KLINE_URL = "https://stock2.finance.sina.com.cn/futures/api/jsonp_v2.php/var%20_t=/InnerFuturesNewService.getDailyKLine?symbol=NR0"
FX_RANGE_URL = "https://api.frankfurter.dev/v1/{start}..{end}?from=USD&to=CNY"
HEADERS = {"Referer": "https://finance.sina.com.cn"}

_kline_cache: tuple[float, list[dict]] = (0.0, [])
_fx_cache: tuple[float, dict[str, float]] = (0.0, {})
_TTL = 3600


def get_nr0_kline() -> list[dict]:
    """Full NR0 daily series, oldest → newest: {date, settle, close, volume, oi}."""
    global _kline_cache
    cached_at, cached = _kline_cache
    if cached and time.time() - cached_at < _TTL:
        return cached
    try:
        resp = get_retry(KLINE_URL, headers=HEADERS, timeout=30, ipv4=True)
        m = re.search(r"var _t=\((.*)\)", resp.text, re.S)
        if not m:
            return cached
        rows = json.loads(m.group(1))
        series = [
            {
                "date": r["d"],
                "settle": float(r["s"]),
                "close": float(r["c"]),
                "volume": int(float(r["v"])),
                "oi": int(float(r["p"])),
            }
            for r in rows
            if r.get("d") and r.get("s")
        ]
        if series:
            _kline_cache = (time.time(), series)
        return series
    except Exception:
        logger.exception("NR0 kline fetch failed — serving cached series")
        return cached


def get_usdcny_by_date(days: int) -> dict[str, float]:
    """ECB reference USD/CNY per date (weekends/holidays absent — callers
    carry the last known rate forward, which is the honest convention)."""
    global _fx_cache
    cached_at, cached = _fx_cache
    if cached and time.time() - cached_at < _TTL:
        return cached
    start = (date.today() - timedelta(days=days + 7)).isoformat()
    end = date.today().isoformat()
    try:
        resp = get_retry(FX_RANGE_URL.format(start=start, end=end), timeout=30, follow_redirects=True)
        rates = resp.json().get("rates") or {}
        out = {d: v["CNY"] for d, v in rates.items() if v.get("CNY")}
        if out:
            _fx_cache = (time.time(), out)
        return out
    except Exception:
        logger.exception("frankfurter USD/CNY range fetch failed — serving cache")
        return cached


def seasonality_envelope() -> dict:
    """Per calendar month across NR0's full history: min / median / max of
    the monthly mean settlement (CNY/tonne), plus the current year's path.
    All arithmetic, no smoothing."""
    series = get_nr0_kline()
    if not series:
        return {"unit": "CNY/tonne", "years": 0, "envelope": [], "current_year": []}

    monthly: dict[tuple[int, int], list[float]] = {}
    for p in series:
        y, m = int(p["date"][:4]), int(p["date"][5:7])
        monthly.setdefault((y, m), []).append(p["settle"])
    means = {ym: sum(v) / len(v) for ym, v in monthly.items()}

    this_year = date.today().year
    envelope = []
    for m in range(1, 13):
        vals = sorted(mean for (y, mm), mean in means.items() if mm == m and y != this_year)
        if not vals:
            continue
        mid = len(vals) // 2
        median = vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
        envelope.append({"month": m, "min": round(min(vals)), "median": round(median), "max": round(max(vals))})

    current = [
        {"month": m, "mean": round(means[(this_year, m)])}
        for m in range(1, 13)
        if (this_year, m) in means
    ]
    years = len({y for (y, _m) in means if y != this_year})
    return {"unit": "CNY/tonne", "years": years, "envelope": envelope, "current_year": current}
