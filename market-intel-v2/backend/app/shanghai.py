"""Shanghai TSR20 futures — the INE "NR" (20号胶) contract — via Sina's
public quote feed.

One GET to hq.sinajs.cn returns comma-separated quote lines for every
requested contract: open/high/low/last, settlement + previous settlement,
volume and open interest, all in CNY per tonne. The board mirrors the SGX
one: first four active delivery months, everything applied on every poll.

Field order in Sina's futures payload (nf_*):
  [0] name  [2] open  [3] high  [4] low  [8] last  [9] settlement
  [10] prev settlement  [13] open interest  [14] volume  [17] date
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.models import FuturesQuote

logger = logging.getLogger("market_intel")

SINA_URL = "https://hq.sinajs.cn/list="
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0",
    "Referer": "https://finance.sina.com.cn",
}
BOARD_MONTHS = 4

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

_last_sync_at: datetime | None = None
# Open interest at the start of the current trading date, per contract —
# what makes "Change in OI" mean today's change, like the SGX board.
_day_start_oi: dict[str, tuple[str, float]] = {}


def get_shanghai_sync_status() -> str | None:
    return _last_sync_at.isoformat() if _last_sync_at else None


def _candidate_codes(n: int = 8) -> list[str]:
    """Next n contract codes (YYMM) from the current month on."""
    today = date.today()
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append(f"{y % 100:02d}{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def fetch_shanghai_rows() -> list[dict]:
    codes = _candidate_codes()
    symbols = ",".join(f"nf_NR{c}" for c in codes)
    resp = httpx.get(SINA_URL + symbols, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    rows = []
    for code, line in zip(codes, resp.text.splitlines()):
        m = re.search(r'"([^"]*)"', line)
        if not m or not m.group(1):
            continue
        f = m.group(1).split(",")
        if len(f) < 18:
            continue
        try:
            open_, high, low = float(f[2]), float(f[3]), float(f[4])
            last, settle, prev_settle = float(f[8]), float(f[9]), float(f[10])
            oi, volume = float(f[13]), float(f[14])
        except ValueError:
            continue
        price = last or settle or prev_settle
        if not price or (not oi and not volume):
            continue  # dead/unlisted month
        year = 2000 + int(code[:2])
        month = int(code[2:])
        rows.append(
            {
                "contract": f"NR{code}",
                "label": f"{MONTH_ABBR[month - 1]} {year}",
                "month_order": year * 12 + month,
                "price": price,
                "open": open_,
                "high": high,
                "low": low,
                "volume": volume,
                "close": prev_settle,  # L.S — previous session's settlement
                "open_interest": oi,
                "trade_date": f[17] if len(f) > 17 else "",
            }
        )
    rows.sort(key=lambda r: r["month_order"])
    return rows[:BOARD_MONTHS]


def sync_shanghai_quotes(db: Session) -> int:
    """Apply the Sina feed straight to the SHNR board — no gating, same as
    the SGX board."""
    global _last_sync_at
    rows = fetch_shanghai_rows()
    if not rows:
        return 0

    synced_labels = []
    for row in rows:
        label = row["label"]
        synced_labels.append(label)
        q = (
            db.query(FuturesQuote)
            .filter(FuturesQuote.market_tag == "SHNR", FuturesQuote.contract_month == label)
            .first()
        )
        if q is None:
            q = FuturesQuote(market_tag="SHNR", contract_month=label, month_order=row["month_order"], price=row["price"])
            db.add(q)

        # "Change in OI" = today's change: delta from the OI we held when the
        # trading date first rolled over (falls back to the stored value on a
        # fresh process, which starts the day's delta from now).
        day_key = row["trade_date"]
        prev = _day_start_oi.get(row["contract"])
        if prev is None or prev[0] != day_key:
            _day_start_oi[row["contract"]] = (day_key, q.open_interest or row["open_interest"])
        start_oi = _day_start_oi[row["contract"]][1]
        q.oi_change = row["open_interest"] - start_oi

        q.month_order = row["month_order"]
        q.price = row["price"]
        q.open = row["open"]
        q.high = row["high"]
        q.low = row["low"]
        q.volume = row["volume"]
        q.close = row["close"]
        q.open_interest = row["open_interest"]

    db.query(FuturesQuote).filter(
        FuturesQuote.market_tag == "SHNR",
        FuturesQuote.contract_month.notin_(synced_labels),
    ).delete(synchronize_session=False)

    db.commit()
    _last_sync_at = datetime.now(timezone.utc)
    return len(rows)
