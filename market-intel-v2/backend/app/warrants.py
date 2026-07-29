"""INE NR (TSR20) on-warrant warehouse stocks.

Source: East Money's public datacenter API (datacenter-web.eastmoney.com),
which mirrors the exchange's daily warrant figures — the SHFE/INE sites
themselves sit behind a WAF that blocks datacenter traffic, so the mirror is
the practical free source. Figures are the exchange's own: tonnes on warrant
per trade date, plus the daily change.

Security code "nr" = 上期能源-20号胶 (INE TSR20). The SHFE "RU" contract is
whole-latex/RSS-based and stays out — the desk trades TSR20 only.
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta

import httpx

logger = logging.getLogger("market_intel")

API = "https://datacenter-web.eastmoney.com/api/data/v1/get"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    "Referer": "https://data.eastmoney.com/ifdata/kcsj.html",
}

# (fetched_at_epoch, series) per requested day-span — the figure changes once
# per trading day, so an hour of cache is generous.
_cache: dict[int, tuple[float, list[dict]]] = {}
_TTL = 3600


def get_nr_warrant_stocks(days: int = 180) -> list[dict]:
    """Daily series, oldest → newest: {date, tonnes, change}."""
    days = min(days, 365)
    cached_at, cached = _cache.get(days, (0.0, []))
    if cached and time.time() - cached_at < _TTL:
        return cached

    since = (date.today() - timedelta(days=days)).isoformat()
    try:
        resp = httpx.get(
            API,
            params={
                "reportName": "RPT_FUTU_STOCKDATA",
                "columns": "TRADE_DATE,ON_WARRANT_NUM,ADDCHANGE",
                "filter": f'(SECURITY_CODE="nr")(TRADE_DATE>=\'{since}\')',
                "pageSize": 500,
                "sortColumns": "TRADE_DATE",
                "sortTypes": 1,
                "source": "WEB",
                "client": "WEB",
            },
            headers=HEADERS,
            timeout=25,
        )
        resp.raise_for_status()
        data = (resp.json().get("result") or {}).get("data") or []
        series = [
            {
                "date": row["TRADE_DATE"][:10],
                "tonnes": row["ON_WARRANT_NUM"],
                "change": row.get("ADDCHANGE") or 0,
            }
            for row in data
            if row.get("ON_WARRANT_NUM") is not None and row.get("TRADE_DATE")
        ]
        if series:
            _cache[days] = (time.time(), series)
        return series
    except Exception:
        logger.exception("NR warrant stock fetch failed — serving cached series")
        return cached
