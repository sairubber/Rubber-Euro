"""Japan (JPX/OSE) TSR20 rubber futures via TradingView's scanner.

Honest context: OSE lists a TSR20 contract (JPY/kg) but it barely trades —
volume and open interest sit at zero most sessions, and only the front
continuous contract (TOCOM:TSR21!) carries data on any free feed; the back
months publish nothing because nothing trades. The board therefore shows the
front month only, clearly labelled.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.models import FuturesQuote

logger = logging.getLogger("market_intel")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0",
    "Content-Type": "application/json",
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
}

_last_sync_at: datetime | None = None


def get_japan_sync_status() -> str | None:
    return _last_sync_at.isoformat() if _last_sync_at else None


def sync_japan_quotes(db: Session) -> int:
    global _last_sync_at
    body = {
        "symbols": {"tickers": ["TOCOM:TSR21!"]},
        "columns": ["close", "open", "high", "low", "volume", "open_interest", "prev_close"],
    }
    resp = httpx.post("https://scanner.tradingview.com/futures/scan", json=body, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    data = resp.json().get("data") or []
    if not data:
        return 0
    close, open_, high, low, volume, oi, prev_close = (data[0]["d"] + [None] * 7)[:7]
    if not close:
        return 0

    label = "Front month"
    q = (
        db.query(FuturesQuote)
        .filter(FuturesQuote.market_tag == "JPNR", FuturesQuote.contract_month == label)
        .first()
    )
    if q is None:
        q = FuturesQuote(market_tag="JPNR", contract_month=label, month_order=0, price=float(close))
        db.add(q)

    new_oi = float(oi or 0)
    if q.open_interest and new_oi != q.open_interest:
        q.oi_change = new_oi - q.open_interest
    q.open_interest = new_oi
    q.price = float(close)
    q.open = float(open_ or close)
    q.high = float(high or close)
    q.low = float(low or close)
    q.volume = float(volume or 0)
    # L.S: previous close when the feed carries one, else the price itself
    # (a market with no trades has no meaningful daily change).
    q.close = float(prev_close or close)

    db.commit()
    _last_sync_at = datetime.now(timezone.utc)
    return 1
