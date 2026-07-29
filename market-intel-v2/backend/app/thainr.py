"""STR20 FOB Laem Chabang — Thai Rubber Association's published offer price.

Source: thainr.com homepage widget ("Offer Price, FOB Laemchabang"), which
the association updates on trading days, quoted in THB/kg. The RAOT site is
behind a bot-wall; TRA is the association's own public number and fetches
cleanly.

The desk is USD-only, so the THB figure is converted at the live USDTHB rate
AT FETCH TIME and stored per date — history keeps each day's own conversion
instead of silently re-pricing the past with today's FX.

STR20 only (TSR20-only desk); the widget's RSS/latex quotes are ignored.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from app.models import FxRate, ThaiFobPrice

logger = logging.getLogger("market_intel")

TRA_URL = "https://www.thainr.com/en/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
}

# The date sits after a <br/> inside the header ("FOB ... (Laemchabang)<br/>
# 24 July 2026"), so the window between anchor and date must allow tags.
# \s in these windows also swallows &nbsp; once entities are normalised.
_DATE_RE = re.compile(r"Laemchabang\)?[\s\S]{0,120}?(\d{1,2}\s+\w+\s+\d{4})")
_STR20_RE = re.compile(r"\(\s*STR\s*20\s*\)[\s\S]{0,300}?([\d.,]+)\s*BAHT\s*/\s*KG", re.I)

_cache: tuple[float, dict | None] = (0.0, None)
_TTL = 3600


def fetch_str20() -> dict | None:
    """{price_date: 'YYYY-MM-DD', thb_kg: float} from the TRA homepage."""
    global _cache
    cached_at, cached = _cache
    if cached and time.time() - cached_at < _TTL:
        return cached
    for attempt in (1, 2):  # one retry — TRA's shared host hiccups occasionally
        try:
            resp = httpx.get(TRA_URL, headers=HEADERS, timeout=25, follow_redirects=True)
            resp.raise_for_status()
            text = resp.text.replace("&nbsp;", " ")
            date_m = _DATE_RE.search(text)
            price_m = _STR20_RE.search(text)
            if not date_m or not price_m:
                logger.warning("TRA page fetched but STR20 widget not found — layout may have changed")
                return cached
            price_date = datetime.strptime(date_m.group(1), "%d %B %Y").date().isoformat()
            thb = float(price_m.group(1).replace(",", ""))
            if not 20 < thb < 300:  # a parse that lands outside any plausible THB/kg is a bug, not a price
                logger.warning("TRA STR20 parsed to implausible %s THB/kg — keeping cache", thb)
                return cached
            state = {"price_date": price_date, "thb_kg": thb}
            _cache = (time.time(), state)
            return state
        except Exception:
            if attempt == 2:
                logger.exception("TRA STR20 fetch failed twice — serving cached value")
            else:
                time.sleep(2)
    return cached


def sync_str20(db: Session) -> dict | None:
    """Fetch the current TRA print, convert at the live USDTHB rate, upsert
    one row per price date, and return the latest stored figures."""
    current = fetch_str20()
    if current is None:
        latest = db.query(ThaiFobPrice).order_by(ThaiFobPrice.price_date.desc()).first()
        return {"price_date": latest.price_date, "thb_kg": latest.thb_kg, "usd_mt": latest.usd_mt} if latest else None

    usdthb = db.query(FxRate).filter(FxRate.pair == "USDTHB").first()
    usd_mt = round(current["thb_kg"] * 1000 / usdthb.rate, 1) if usdthb and usdthb.rate else None

    row = db.query(ThaiFobPrice).filter(ThaiFobPrice.price_date == current["price_date"]).first()
    if row is None:
        row = ThaiFobPrice(price_date=current["price_date"], thb_kg=current["thb_kg"], usd_mt=usd_mt)
        db.add(row)
        db.commit()
    elif row.thb_kg != current["thb_kg"] or (usd_mt is not None and row.usd_mt != usd_mt):
        # Only touch the DB when the print actually moved — this sync runs on
        # every basis/bulletin request, and identical rewrites are pure churn.
        row.thb_kg = current["thb_kg"]
        if usd_mt is not None:
            row.usd_mt = usd_mt
        db.commit()
    return {"price_date": row.price_date, "thb_kg": row.thb_kg, "usd_mt": row.usd_mt}
