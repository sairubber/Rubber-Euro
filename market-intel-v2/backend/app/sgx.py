"""Live SGX SICOM TSR20 futures via SGX's own delayed-prices API.

The endpoint behind sgx.com/derivatives/delayed-prices-futures (found by
watching the page's network traffic) is public and needs no key — it serves
the same ~10-minute-delayed data the website shows. Akamai rejects bare
clients, so the request carries ordinary browser headers.

Field mapping (non-"abs"/"adj" fields are already in the $/tonne scale the
desk sheet uses — 2195, not 219.5):
  last-trade-price               -> price (T)
  session-open / -high / -low    -> Open / High / Low
  total-volume                   -> Volume (Vcon)
  daily- or preliminary-settlement-price -> Closing Price (L.S)
  open-interest                  -> Open Interest

SGX publishes open interest once daily, so the OI change is computed here as
(new OI − stored OI) at the moment it actually moves, which lands once per
session — the same daily delta the sheet tracks by hand.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

_front_history_cache: dict[int, tuple[float, list[dict]]] = {}
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

import httpx

from app.models import FuturesQuote, PriceTick
from app.prices import detect_level_breaks, record_tick_if_moved

IST_TZ = ZoneInfo("Asia/Kolkata")

# No gating: every poll applies straight to the board — the only latency is
# the source's own (~10-min delayed feed, polled every minute). The
# previous-day closing price (L.S) is still set once per day because that is
# what the column MEANS, not a throttle.

logger = logging.getLogger("market_intel")

SGX_URL = "https://api.sgx.com/derivatives/v1.0/contract-code/TF"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "application/json",
    "Origin": "https://www.sgx.com",
    "Referer": "https://www.sgx.com/",
    "Accept-Language": "en-US,en;q=0.9",
}
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

# The board shows the first five delivery months (through December from an
# August front).
BOARD_MONTHS = 5

_last_sync_at: datetime | None = None
_price_as_of: str | None = None  # the FEED's own last-update stamp (exchange time)
_close_set_on: str | None = None  # IST date the L.S column was last set

SGT = timezone(timedelta(hours=8))


def get_sgx_sync_status() -> str | None:
    return _last_sync_at.isoformat() if _last_sync_at else None


def get_sgx_price_as_of() -> str | None:
    """When the exchange itself last updated the delayed feed — the honest
    'price as of' time, as opposed to when we fetched it."""
    return _price_as_of


def _pick(row: dict, *keys: str) -> float | None:
    for k in keys:
        v = row.get(k)
        if v is not None:
            return float(v)
    return None


def fetch_sgx_rows() -> list[dict]:
    params = {
        "order": "asc",
        "orderby": "delivery-month",
        "category": "futures",
        "session": "-1",
        "t": str(int(time.time() * 1000)),
    }
    resp = httpx.get(SGX_URL, params=params, headers=HEADERS, timeout=25)
    resp.raise_for_status()
    data = resp.json().get("data", [])
    # Two rows per delivery month (T and T+1 sessions) — keep the T session,
    # which is the one carrying prices.
    by_month: dict[str, dict] = {}
    for row in data:
        month = row.get("delivery-month") or ""
        if not month:
            continue
        if row.get("current-trading-session") == "0" or month not in by_month:
            by_month.setdefault(month, row)
            if row.get("current-trading-session") == "0":
                by_month[month] = row
    return [by_month[m] for m in sorted(by_month)][:BOARD_MONTHS]


def get_front_history(days: int = 90) -> list[dict]:
    """The daily series SGX's own product chart plots — settlement price,
    volume and open interest per session for the front-month contract, from
    the same public API the exchange website uses. Prices arrive in the
    cents/kg scale (218.4) and are converted to the board's $/tonne scale
    (2184). Cached for 15 minutes; it only gains a point once per session."""
    days = min(days, 365)
    cached_at, cached = _front_history_cache.get(days, (0.0, []))
    if cached and time.time() - cached_at < 900:
        return cached
    try:
        rows = fetch_sgx_rows()
        if not rows:
            return cached
        symbol = rows[0].get("symbol")
        if not symbol:
            return cached
        resp = httpx.get(
            f"https://api.sgx.com/derivatives/v1.0/history/symbol/{symbol}",
            params={"days": f"{days}d"},
            headers=HEADERS,
            timeout=25,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        series = []
        for rec in data:
            close = rec.get("daily-settlement-price") or rec.get("last-trade-price")
            # A handful of sessions come back with 0.0 settlements (data
            # gaps on SGX's side) — plotting them would spike the line to 0.
            if not close or not rec.get("record-date"):
                continue
            series.append(
                {
                    # SGX sessions settle 16:00 SGT — pin the point there so
                    # today's live ticks always sort after the last close.
                    "ts": f"{rec['record-date']}T08:00:00+00:00",
                    "price": round(float(close) * 10, 2),
                    "volume": rec.get("total-volume") or 0,
                    "open_interest": rec.get("open-interest") or 0,
                }
            )
        series.sort(key=lambda x: x["ts"])
        if series:
            _front_history_cache[days] = (time.time(), series)
        return series
    except Exception:
        logger.exception("SGX history fetch failed — serving cached series")
        return cached


def sync_sgx_quotes(db: Session, force: bool = False) -> int:
    """Pull the SGX board and apply it straight through. Returns rows
    touched.

    - Price (T) and O/H/L/Volume/OI: applied on EVERY pass, no gating — the
      board shows exactly what the feed shows, as soon as we see it.
    - Closing Price (L.S): previous day's settlement, set once per IST day —
      that is the column's meaning, not a throttle.
    - Every pass also appends the front-month price to the "TSR20_LIVE"
      series when it changed — the live chart line.
    """
    global _last_sync_at, _price_as_of, _close_set_on
    rows = fetch_sgx_rows()
    if not rows:
        return 0

    # The feed's own last-update stamp (Singapore time) — surfaced in the UI
    # as "price as of", separate from when we fetched.
    lut = rows[0].get("last-update-time")
    if lut:
        try:
            _price_as_of = datetime.strptime(lut, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=SGT).isoformat()
        except ValueError:
            pass

    now_ist = datetime.now(IST_TZ)
    today_ist = now_ist.date().isoformat()
    close_due = _close_set_on != today_ist

    synced_months: list[str] = []
    updated = 0
    for row in rows:
        ym = row["delivery-month"]  # "2026-08"
        year, month = int(ym[:4]), int(ym[5:7])
        label = MONTH_NAMES[month - 1]
        synced_months.append(label)

        price = _pick(row, "last-trade-price", "daily-settlement-price", "preliminary-settlement-price", "best-bid-price")
        close = _pick(row, "daily-settlement-price", "preliminary-settlement-price")
        if price is None:
            continue

        q = (
            db.query(FuturesQuote)
            .filter(FuturesQuote.market_tag == "TSR20", FuturesQuote.contract_month == label)
            .first()
        )
        if q is None:
            q = FuturesQuote(market_tag="TSR20", contract_month=label, month_order=0, price=price)
            db.add(q)

        new_oi = _pick(row, "open-interest")
        if new_oi is not None and q.open_interest and new_oi != q.open_interest:
            # OI moves once per session on SGX — this is the daily delta.
            q.oi_change = new_oi - q.open_interest
        if new_oi is not None:
            q.open_interest = new_oi

        q.month_order = year * 12 + month  # sorts correctly across year end
        q.price = price
        q.open = _pick(row, "session-open") or q.open
        q.high = _pick(row, "session-traded-high") or q.high
        q.low = _pick(row, "session-traded-low") or q.low
        q.volume = _pick(row, "total-volume") if _pick(row, "total-volume") is not None else q.volume
        if close is not None and (close_due or not q.close):
            q.close = close
        updated += 1

    if close_due:
        _close_set_on = today_ist

    # Live chart series: every observed front-month price change, no $9 gate.
    front_label = synced_months[0]
    front_row = rows[0]
    live_price = _pick(front_row, "last-trade-price", "daily-settlement-price", "preliminary-settlement-price", "best-bid-price")
    if live_price is not None:
        last_live = (
            db.query(PriceTick)
            .filter(PriceTick.market_tag == "TSR20_LIVE")
            .order_by(PriceTick.ts.desc(), PriceTick.id.desc())
            .first()
        )
        if last_live is None or last_live.price != live_price:
            db.add(PriceTick(market_tag="TSR20_LIVE", price=live_price))
            # A new observed price is the moment a level can be broken —
            # check the move against the computed S/R and log the scenario.
            detect_level_breaks(db, "TSR20", last_live.price if last_live else None, live_price)

    # Board tick history keeps the $9 rule (proven S/R + board cadence).
    front = (
        db.query(FuturesQuote)
        .filter(FuturesQuote.market_tag == "TSR20", FuturesQuote.contract_month == front_label)
        .first()
    )
    if front is not None:
        record_tick_if_moved(db, "TSR20", front.price)

    # An expired contract's row (e.g. "August" after the Aug roll) would sit
    # stale forever — the board is exactly the months SGX currently lists.
    db.query(FuturesQuote).filter(
        FuturesQuote.market_tag == "TSR20",
        FuturesQuote.contract_month.notin_(synced_months),
    ).delete(synchronize_session=False)

    db.commit()
    _last_sync_at = datetime.now(timezone.utc)
    return updated
