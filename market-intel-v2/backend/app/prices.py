"""Price board, tick history, and rule-based support/resistance.

No AI anywhere: FX rates come from open.er-api.com (free, no key), EUR/USD
daily history from frankfurter.dev (free ECB reference rates), and the SGX
TSR20 futures board is keyed in by the desk (SGX has no free feed) exactly
like the Google Sheet it replaces. Support/resistance is a transparent
calculation over those numbers — classic floor pivots plus levels the price
has demonstrably reversed at ("proven"), each with the reason attached.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.models import FuturesQuote, FxRate, LevelEvent, PriceTick

logger = logging.getLogger("market_intel")

# The board updates on every $9 of front-month movement — smaller wiggles are
# noise at TSR20's tick size. FX pairs use 10 pips as the equivalent gate.
TICK_THRESHOLD = {"TSR20": 9.0, "EURUSD": 0.0010}

# Bucket width used when deciding that two touches were "the same level".
LEVEL_BUCKET = {"TSR20": 10.0, "EURUSD": 0.0050}

FX_PAIRS = ("EURUSD", "GBPUSD", "CNYUSD", "USDIDR", "USDCFA", "USDINR", "USDTHB")


def iso_utc(dt: datetime | None) -> str | None:
    """SQLite hands naive datetimes back even for tz-aware columns; they are
    UTC by construction (utcnow), so say so — a bare isoformat() gets parsed
    as *local* time by the browser and shows hours-old timestamps."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

# Initial board — the desk's sheet as of 2026-07-23. Change/pct/prev-OI are
# derived at read time, so only the raw keyed-in numbers live here.
SEED_QUOTES = [
    dict(market_tag="TSR20", contract_month="August", month_order=8, price=2194, open=2184, high=2194, low=2179, volume=140, close=2184, open_interest=1647, oi_change=-290),
    dict(market_tag="TSR20", contract_month="September", month_order=9, price=2164, open=2149, high=2166, low=2145, volume=1582, close=2153, open_interest=10088, oi_change=-815),
    dict(market_tag="TSR20", contract_month="October", month_order=10, price=2159, open=2148, high=2162, low=2144, volume=1642, close=2152, open_interest=15385, oi_change=516),
    dict(market_tag="TSR20", contract_month="November", month_order=11, price=2156, open=2148, high=2161, low=2142, volume=596, close=2151, open_interest=8379, oi_change=249),
]


def seed_quotes_if_empty(db: Session) -> None:
    if db.query(FuturesQuote).first() is not None:
        return
    for row in SEED_QUOTES:
        db.add(FuturesQuote(**row))
    # Only the front month seeds the tick history — the other contract months
    # are curve points, not price movement.
    db.add(PriceTick(market_tag="TSR20", price=SEED_QUOTES[0]["price"]))
    db.commit()
    logger.info("Seeded futures board with %d contract months", len(SEED_QUOTES))


def quote_out(q: FuturesQuote) -> dict:
    change = q.price - q.close if q.close else 0.0
    return {
        "market_tag": q.market_tag,
        "contract_month": q.contract_month,
        "month_order": q.month_order,
        "price": q.price,
        "change": round(change, 2),
        "open": q.open,
        "high": q.high,
        "low": q.low,
        "volume": q.volume,
        "close": q.close,
        "open_interest": q.open_interest,
        "oi_change": q.oi_change,
        "prev_open_interest": round(q.open_interest - q.oi_change, 2),
        "price_change_pct": round(abs(change) / q.close * 100, 2) if q.close else 0.0,
        "updated_at": iso_utc(q.updated_at),
    }


def record_tick_if_moved(db: Session, market_tag: str, price: float) -> bool:
    """Append a tick only when the move from the last stored tick clears the
    market's threshold ($10 for TSR20). Returns True when a tick landed."""
    threshold = TICK_THRESHOLD.get(market_tag, 0.0)
    last = (
        db.query(PriceTick)
        .filter(PriceTick.market_tag == market_tag)
        .order_by(PriceTick.ts.desc(), PriceTick.id.desc())
        .first()
    )
    if last is not None and abs(price - last.price) < threshold:
        return False
    db.add(PriceTick(market_tag=market_tag, price=price))
    return True


def upsert_quote(db: Session, payload: dict) -> FuturesQuote:
    q = (
        db.query(FuturesQuote)
        .filter(
            FuturesQuote.market_tag == payload["market_tag"],
            FuturesQuote.contract_month == payload["contract_month"],
        )
        .first()
    )
    if q is None:
        q = FuturesQuote(market_tag=payload["market_tag"], contract_month=payload["contract_month"], month_order=payload.get("month_order", 0), price=0.0)
        db.add(q)
    old_price = q.price or None
    for field in ("month_order", "price", "open", "high", "low", "volume", "close", "open_interest", "oi_change"):
        if payload.get(field) is not None:
            setattr(q, field, float(payload[field]))
    if payload.get("price") is not None and old_price and q.price != old_price:
        # A keyed-in price is an observed price too — it can break a level.
        detect_level_breaks(db, q.market_tag, old_price, q.price)
    # Front-month price drives the tick history; other months only reshape
    # the curve table.
    front = (
        db.query(FuturesQuote)
        .filter(FuturesQuote.market_tag == q.market_tag)
        .order_by(FuturesQuote.month_order.asc())
        .first()
    )
    if front is None or front.contract_month == q.contract_month:
        record_tick_if_moved(db, q.market_tag, q.price)
    db.commit()
    db.refresh(q)
    return q


# ── FX ────────────────────────────────────────────────────────────────────────


YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
}
YAHOO_SYMBOLS = {
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "CNYUSD": "CNYUSD=X",
    "USDIDR": "IDR=X",
    "USDCFA": "XOF=X",  # CFA franc (BCEAO)
    "USDINR": "INR=X",
    "USDTHB": "THB=X",  # Thai Baht — the origin-side currency for STR20/Hat Yai
}


# Google Finance quote pages (no official API — the rate sits in the page's
# embedded AF_initDataCallback JSON as `"EUR / USD",N,null,[<last>,...]`).
GOOGLE_FX_SLUGS = {
    "EURUSD": ("EUR-USD", "EUR / USD"),
    "GBPUSD": ("GBP-USD", "GBP / USD"),
    "CNYUSD": ("CNY-USD", "CNY / USD"),
    "USDIDR": ("USD-IDR", "USD / IDR"),
    "USDCFA": ("USD-XOF", "USD / XOF"),
    "USDINR": ("USD-INR", "USD / INR"),
    "USDTHB": ("USD-THB", "USD / THB"),
}


def _google_fx_rate(pair: str) -> float | None:
    slug_label = GOOGLE_FX_SLUGS.get(pair)
    if slug_label is None:
        return None
    slug, label = slug_label
    try:
        resp = httpx.get(
            f"https://www.google.com/finance/quote/{slug}",
            headers=YAHOO_HEADERS,
            timeout=15,
            follow_redirects=True,
        )
        resp.raise_for_status()
        m = re.search(rf'"{re.escape(label)}",\d+,null,\[([\d.]+),', resp.text)
        return float(m.group(1)) if m else None
    except Exception:
        logger.warning("Google Finance fetch failed for %s", pair)
        return None


def _yahoo_chart(symbol: str, range_: str = "1d", interval: str = "5m") -> dict | None:
    try:
        resp = httpx.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": range_, "interval": interval},
            headers=YAHOO_HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
        result = resp.json().get("chart", {}).get("result")
        return result[0] if result else None
    except Exception:
        logger.warning("Yahoo fetch failed for %s", symbol)
        return None


def _fx_rates_fallback() -> dict[str, float | None]:
    """open.er-api.com only refreshes daily — kept purely as the fallback for
    when Yahoo hiccups, so the strip degrades to stale-but-real instead of
    blank."""
    resp = httpx.get("https://open.er-api.com/v6/latest/USD", timeout=20)
    resp.raise_for_status()
    rates = resp.json().get("rates", {})

    def usd_per(code: str) -> float | None:
        v = rates.get(code)
        return 1.0 / v if v else None

    return {
        "EURUSD": usd_per("EUR"),
        "GBPUSD": usd_per("GBP"),
        "CNYUSD": usd_per("CNY"),
        "USDIDR": rates.get("IDR"),
        "USDCFA": rates.get("XOF"),
        "USDINR": rates.get("INR"),
        "USDTHB": rates.get("THB"),
    }


def refresh_fx_rates(db: Session) -> int:
    """Live spot rates, Google Finance first (the same numbers the Google
    quote page shows), Yahoo's chart API as fallback per pair, er-api as the
    last resort. EURUSD also lands in the tick history when it moved."""
    computed: dict[str, float | None] = {}
    for pair, symbol in YAHOO_SYMBOLS.items():
        rate = _google_fx_rate(pair)
        if rate is None:
            chart = _yahoo_chart(symbol, range_="1d", interval="5m")
            price = (chart or {}).get("meta", {}).get("regularMarketPrice")
            rate = float(price) if price else None
        computed[pair] = rate

    if all(v is None for v in computed.values()):
        try:
            computed = _fx_rates_fallback()
        except Exception:
            logger.exception("FX fetch failed on both sources — keeping previous rates")
            return 0
    updated = 0
    prev_eur: float | None = None
    for pair, rate in computed.items():
        if rate is None:
            continue
        row = db.query(FxRate).filter(FxRate.pair == pair).first()
        if pair == "EURUSD":
            prev_eur = row.rate if row is not None else None
        if row is None:
            db.add(FxRate(pair=pair, rate=rate, prev_rate=None))
        else:
            if row.rate != rate:
                row.prev_rate = row.rate
                row.rate = rate
            row.fetched_at = datetime.now(timezone.utc)
        updated += 1
    if computed.get("EURUSD"):
        record_tick_if_moved(db, "EURUSD", computed["EURUSD"])
        detect_level_breaks(db, "EURUSD", prev_eur, computed["EURUSD"])
    db.commit()
    return updated


_fx_intraday_cache: dict[str, tuple[float, list[dict]]] = {}


def get_fx_intraday(pair: str) -> list[dict]:
    """Today's 5-minute intraday line for an FX pair, straight from Yahoo,
    cached for a minute — this is what makes the FX chart live."""
    cached = _fx_intraday_cache.get(pair)
    if cached and time.time() - cached[0] < 60:
        return cached[1]
    symbol = YAHOO_SYMBOLS.get(pair)
    if symbol is None:
        return []
    chart = _yahoo_chart(symbol, range_="1d", interval="5m")
    if chart is None:
        return cached[1] if cached else []
    stamps = chart.get("timestamp") or []
    quote = (chart.get("indicators", {}).get("quote") or [{}])[0]
    series = []
    for i, ts in enumerate(stamps):
        c = (quote.get("close") or [None] * len(stamps))[i]
        if c is None:
            continue
        o = (quote.get("open") or [None] * len(stamps))[i]
        h = (quote.get("high") or [None] * len(stamps))[i]
        low = (quote.get("low") or [None] * len(stamps))[i]
        series.append(
            {
                "ts": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
                "price": round(float(c), 6),
                "open": round(float(o), 6) if o is not None else round(float(c), 6),
                "high": round(float(h), 6) if h is not None else round(float(c), 6),
                "low": round(float(low), 6) if low is not None else round(float(c), 6),
                "close": round(float(c), 6),
            }
        )
    if series:
        _fx_intraday_cache[pair] = (time.time(), series)
    return series


_eurusd_prev_ohlc_cache: tuple[float, tuple[float, float, float] | None] = (0.0, None)


def get_eurusd_prev_day_ohlc() -> tuple[float, float, float] | None:
    """Previous completed session's H/L/C for EUR/USD from Yahoo's daily
    candles — the inputs for the Traditional daily pivots (the same study
    TradingView plots on the chart). Cached 10 minutes; it only changes once
    per session."""
    global _eurusd_prev_ohlc_cache
    cached_at, cached = _eurusd_prev_ohlc_cache
    if cached and time.time() - cached_at < 600:
        return cached
    chart = _yahoo_chart("EURUSD=X", range_="5d", interval="1d")
    if chart is None:
        return cached
    stamps = chart.get("timestamp") or []
    quote = (chart.get("indicators", {}).get("quote") or [{}])[0]
    today = datetime.now(timezone.utc).date()
    rows = []
    for i, ts in enumerate(stamps):
        h = (quote.get("high") or [None] * len(stamps))[i]
        l = (quote.get("low") or [None] * len(stamps))[i]
        c = (quote.get("close") or [None] * len(stamps))[i]
        if None in (h, l, c):
            continue
        day = datetime.fromtimestamp(ts, tz=timezone.utc).date()
        rows.append((day, float(h), float(l), float(c)))
    completed = [r for r in rows if r[0] < today]
    if not completed:
        return cached
    _, h, l, c = completed[-1]
    _eurusd_prev_ohlc_cache = (time.time(), (h, l, c))
    return (h, l, c)


# Trader-language readings per pivot rank — what the level means in the
# market, not how it is computed.
PIVOT_READINGS = {
    "Pivot (P)": "The session's balance point — trading above it keeps intraday control with buyers; trading below it hands the wheel to sellers.",
    "R1 pivot": "First ceiling above the pivot — intraday rallies usually pause or stall here before attempting anything bigger.",
    "S1 pivot": "First floor below the pivot — dips typically meet their first real buying here.",
    "R2 pivot": "The edge of a normal session's range — price up here means an unusually strong day, and momentum often cools.",
    "S2 pivot": "The downside edge of a normal session's range — reaching it marks heavy selling, and bounces often start here.",
    "R3 pivot": "Extension level — only strongly trending sessions get here; watch for exhaustion or a fresh acceleration.",
    "S3 pivot": "Downside extension — only heavy one-way selling reaches it; capitulation bounces are common here.",
    "R4 pivot": "Outer extension — rare territory hit in runaway rallies; reversal risk is at its highest.",
    "S4 pivot": "Outer downside extension — panic-move territory; sharp snap-backs often begin here.",
    "R5 pivot": "Extreme extension — almost never traded; a session here is a full-blown event.",
    "S5 pivot": "Extreme downside extension — crash-day territory.",
}


def traditional_pivots(h: float, l: float, c: float) -> list[tuple[float, str, str]]:
    """TradingView's 'Pivots Traditional' level set, verified against the
    chart's own plotted values. Readings, not formulas, go to the UI."""
    p = (h + l + c) / 3
    prices = [
        (p, "Pivot (P)"),
        (2 * p - l, "R1 pivot"),
        (2 * p - h, "S1 pivot"),
        (p + (h - l), "R2 pivot"),
        (p - (h - l), "S2 pivot"),
        (h + 2 * (p - l), "R3 pivot"),
        (l - 2 * (h - p), "S3 pivot"),
        (3 * p + h - 3 * l, "R4 pivot"),
        (3 * p - 3 * h + l, "S4 pivot"),
        (4 * p + h - 4 * l, "R5 pivot"),
        (4 * p - 4 * h + l, "S5 pivot"),
    ]
    return [(price, name, PIVOT_READINGS[name]) for price, name in prices]


# TradingView's scanner exposes its own computed pivot values — the exact
# numbers the chart's "Pivots Traditional (Auto)" study draws at each chart
# timeframe. P/R1/R2/S1/S2 come straight from the scanner; the outer levels
# are reconstructed from the same session H/L (recovered from P/R1/S1), so
# every level matches the chart.
TV_TF_SUFFIX = {"15m": "|15", "1h": "|60", "4h": "|240", "1d": "", "1w": "|1W", "1mo": "|1M"}
_tv_pivots_cache: dict[str, tuple[float, list[tuple[float, str, str]]]] = {}


def get_tv_pivots(tf: str = "15m") -> list[tuple[float, str, str]]:
    suffix = TV_TF_SUFFIX.get(tf)
    if suffix is None:
        return []
    cached_at, cached = _tv_pivots_cache.get(tf, (0.0, []))
    if cached and time.time() - cached_at < 300:
        return cached
    try:
        cols = [f"Pivot.M.Classic.{n}{suffix}" for n in ("Middle", "R1", "S1", "R2", "S2")]
        resp = httpx.post(
            "https://scanner.tradingview.com/forex/scan",
            json={"symbols": {"tickers": ["FX:EURUSD"]}, "columns": cols},
            headers={**YAHOO_HEADERS, "Content-Type": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        p, r1, s1, r2, s2 = resp.json()["data"][0]["d"]
        if None in (p, r1, s1):
            return cached
        h, l = 2 * p - s1, 2 * p - r1  # recover the pivot session's range
        prices = [
            (p, "Pivot (P)"),
            (r1, "R1 pivot"),
            (s1, "S1 pivot"),
            (r2 if r2 is not None else p + (h - l), "R2 pivot"),
            (s2 if s2 is not None else p - (h - l), "S2 pivot"),
            (h + 2 * (p - l), "R3 pivot"),
            (l - 2 * (h - p), "S3 pivot"),
            (3 * p + h - 3 * l, "R4 pivot"),
            (3 * p - 3 * h + l, "S4 pivot"),
            (4 * p + h - 4 * l, "R5 pivot"),
            (4 * p - 4 * h + l, "S5 pivot"),
        ]
        out = [(price, name, PIVOT_READINGS[name]) for price, name in prices]
        _tv_pivots_cache[tf] = (time.time(), out)
        return out
    except Exception:
        logger.warning("TradingView pivot fetch failed for tf=%s", tf)
        return cached


_eurusd_history_cache: tuple[float, list[dict]] = (0.0, [])


def get_eurusd_history(days: int = 90) -> list[dict]:
    """Daily ECB reference closes from frankfurter.dev, cached for an hour —
    the chart doesn't need more than daily granularity for history, and the
    intraday line comes from our own ticks."""
    global _eurusd_history_cache
    cached_at, cached = _eurusd_history_cache
    if cached and time.time() - cached_at < 3600:
        return cached[-days:]
    start = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    try:
        resp = httpx.get(
            f"https://api.frankfurter.dev/v1/{start}..",
            params={"base": "EUR", "symbols": "USD"},
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json().get("rates", {})
        series = [{"date": d, "rate": v["USD"]} for d, v in sorted(data.items()) if "USD" in v]
        if series:
            _eurusd_history_cache = (time.time(), series)
        return series
    except Exception:
        logger.exception("EUR/USD history fetch failed")
        return cached[-days:] if cached else []


# ── Support / resistance ─────────────────────────────────────────────────────


def _proven_levels(db: Session, market_tag: str, current: float) -> list[dict]:
    """Levels the stored tick history has actually reversed at.

    A "touch" is a local extreme in the tick sequence (the price came to a
    bucket and turned away). Two or more touches of the same bucket make the
    level proven — the market demonstrably rejected it more than once."""
    bucket = LEVEL_BUCKET.get(market_tag, 1.0)
    # TSR20's every-poll live series ("TSR20_LIVE") sees far more reversals
    # than the $9 board ticks — use it for proven-level detection when it
    # exists, so levels come from actual observed turns.
    source_tags = [f"{market_tag}_LIVE", market_tag] if market_tag == "TSR20" else [market_tag]
    ticks: list[float] = []
    for tag in source_tags:
        ticks = [
            t.price
            for t in db.query(PriceTick)
            .filter(PriceTick.market_tag == tag)
            .order_by(PriceTick.ts.asc(), PriceTick.id.asc())
            .all()
        ]
        if len(ticks) >= 3:
            break
    touches: dict[float, int] = {}
    for i in range(1, len(ticks) - 1):
        prev_, cur, next_ = ticks[i - 1], ticks[i], ticks[i + 1]
        is_high = cur >= prev_ and cur > next_
        is_low = cur <= prev_ and cur < next_
        if is_high or is_low:
            level = round(round(cur / bucket) * bucket, 4)
            touches[level] = touches.get(level, 0) + 1
    out = []
    for level, count in touches.items():
        if count < 2 or level == 0:
            continue
        kind = "support" if level <= current else "resistance"
        out.append(
            {
                "price": level,
                "kind": kind,
                "label": f"Proven {kind}",
                "proven": True,
                "strength": count,
                "reason": f"Price reversed at this level {count} times in the stored tick history — repeatedly rejected, which is what makes it proven rather than theoretical.",
            }
        )
    return out


def compute_levels(db: Session, market_tag: str, tf: str = "15m") -> dict:
    """Pivots + session extremes + proven reversals + round numbers, each
    carrying the reason it qualifies. Pure arithmetic over stored data."""
    levels: list[dict] = []
    current: float | None = None
    session_label = ""

    if market_tag == "TSR20":
        front = (
            db.query(FuturesQuote)
            .filter(FuturesQuote.market_tag == "TSR20")
            .order_by(FuturesQuote.month_order.asc())
            .first()
        )
        if front is None:
            return {"market_tag": market_tag, "current_price": None, "levels": [], "session": ""}
        current = front.price
        session_label = f"{front.contract_month} (front month)"
        h, l, c = front.high, front.low, front.close
        if h and l and c:
            p = (h + l + c) / 3
            r1, s1 = 2 * p - l, 2 * p - h
            r2, s2 = p + (h - l), p - (h - l)
            for price, name, kind, why in (
                (p, "Pivot (P)", "support" if p <= current else "resistance", PIVOT_READINGS["Pivot (P)"]),
                (r1, "R1 pivot", "resistance", PIVOT_READINGS["R1 pivot"]),
                (s1, "S1 pivot", "support", PIVOT_READINGS["S1 pivot"]),
                (r2, "R2 pivot", "resistance", PIVOT_READINGS["R2 pivot"]),
                (s2, "S2 pivot", "support", PIVOT_READINGS["S2 pivot"]),
            ):
                levels.append({"price": round(price, 2), "kind": kind, "label": name, "proven": False, "strength": 1, "reason": why})
        if h:
            levels.append({"price": h, "kind": "resistance", "label": "Session high", "proven": False, "strength": 1, "reason": "Intraday high of the front-month session — sellers appeared here at least once today."})
        if l:
            levels.append({"price": l, "kind": "support", "label": "Session low", "proven": False, "strength": 1, "reason": "Intraday low of the front-month session — buyers stepped in here at least once today."})
        # Round numbers: TSR20 trades in whole dollars; 50s cluster orders.
        below = int(current // 50) * 50
        above = below + 50
        levels.append({"price": float(below), "kind": "support", "label": "Round number", "proven": False, "strength": 1, "reason": "Nearest $50 round number below — resting orders cluster at round figures."})
        levels.append({"price": float(above), "kind": "resistance", "label": "Round number", "proven": False, "strength": 1, "reason": "Nearest $50 round number above — resting orders cluster at round figures."})

    elif market_tag == "EURUSD":
        fx = db.query(FxRate).filter(FxRate.pair == "EURUSD").first()
        history = get_eurusd_history(90)
        if fx is not None:
            current = fx.rate
        elif history:
            current = history[-1]["rate"]
        if current is None:
            return {"market_tag": market_tag, "current_price": None, "levels": [], "session": ""}
        session_label = f"spot · TradingView pivots ({tf} chart) + 90d swings"

        # Intraday layer: the exact levels TradingView's pivot study draws at
        # the chosen chart timeframe — pulled from TradingView's own engine,
        # falling back to computing them from the previous session if the
        # scanner is unreachable. Each level re-sides live (support ↔
        # resistance) as the market crosses it, and break detection watches
        # them like every other level.
        pivots = get_tv_pivots(tf)
        if not pivots:
            prev = get_eurusd_prev_day_ohlc()
            if prev:
                pivots = traditional_pivots(*prev)
        for price, name, why in pivots:
            kind = "support" if price <= current else "resistance"
            levels.append(
                {
                    "price": round(price, 5),
                    "kind": kind,
                    "label": name,
                    "proven": False,
                    "strength": 1,
                    "reason": why,
                }
            )

        closes = [pt["rate"] for pt in history]
        if len(closes) >= 7:
            # Swing highs/lows over the daily series, clustered to half-cent
            # buckets — a bucket hit twice is a proven daily level.
            bucket = LEVEL_BUCKET["EURUSD"]
            swings: dict[float, int] = {}
            for i in range(2, len(closes) - 2):
                window = closes[i - 2 : i + 3]
                if closes[i] == max(window) or closes[i] == min(window):
                    level = round(round(closes[i] / bucket) * bucket, 4)
                    swings[level] = swings.get(level, 0) + 1
            for level, count in swings.items():
                kind = "support" if level <= current else "resistance"
                levels.append(
                    {
                        "price": level,
                        "kind": kind,
                        "label": f"Daily swing {kind}" if count < 2 else f"Proven {kind}",
                        "proven": count >= 2,
                        "strength": count,
                        "reason": f"Daily closes put a swing extreme in this half-cent zone {count} time(s) over the last 90 sessions."
                        + (" Multiple rejections make it proven." if count >= 2 else ""),
                    }
                )
            hi, lo = max(closes), min(closes)
            levels.append({"price": round(hi, 5), "kind": "resistance", "label": "90-day high", "proven": False, "strength": 1, "reason": "Highest daily close of the last 90 sessions — the ceiling of the recent range."})
            levels.append({"price": round(lo, 5), "kind": "support", "label": "90-day low", "proven": False, "strength": 1, "reason": "Lowest daily close of the last 90 sessions — the floor of the recent range."})
        below = round(int(current * 100) / 100, 2)
        levels.append({"price": below, "kind": "support", "label": "Round number", "proven": False, "strength": 1, "reason": "Nearest whole cent below — option strikes and orders cluster at round figures."})
        levels.append({"price": round(below + 0.01, 2), "kind": "resistance", "label": "Round number", "proven": False, "strength": 1, "reason": "Nearest whole cent above — option strikes and orders cluster at round figures."})

    levels.extend(_proven_levels(db, market_tag, current or 0.0))

    # Merge duplicates landing in the same bucket: keep the strongest claim.
    # The merge bucket is finer than the proven-detection bucket for FX —
    # daily pivots sit ~25-45 pips apart and a half-cent bucket would
    # swallow them into the swing levels.
    bucket = 0.0010 if market_tag == "EURUSD" else LEVEL_BUCKET.get(market_tag, 1.0)
    merged: dict[tuple[float, str], dict] = {}
    for lv in levels:
        key = (round(round(lv["price"] / bucket) * bucket, 4), lv["kind"])
        keep = merged.get(key)
        if keep is None or (lv["proven"], lv["strength"]) > (keep["proven"], keep["strength"]):
            merged[key] = lv
    supports = sorted((lv for lv in merged.values() if lv["kind"] == "support"), key=lambda x: -x["price"])
    resistances = sorted((lv for lv in merged.values() if lv["kind"] == "resistance"), key=lambda x: x["price"])
    cap = 8 if market_tag == "EURUSD" else 6

    return {
        "market_tag": market_tag,
        "current_price": current,
        "session": session_label,
        "levels": supports[:cap] + resistances[:cap],
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Break detection ──────────────────────────────────────────────────────────


def _fmt_price(market_tag: str, v: float) -> str:
    return f"{v:.0f}" if market_tag == "TSR20" else f"{v:.4f}"


def detect_level_breaks(db: Session, market_tag: str, prev_price: float | None, new_price: float | None) -> int:
    """Compare two consecutive observed prices against the computed levels
    and record every level the move crossed, with a plain-arithmetic
    explanation of the scenario at that moment. Returns events written.

    The caller commits. A repeat crossing of the same level in the same
    direction within 30 minutes is skipped — whipsaw around a level is one
    story, not ten."""
    if prev_price is None or new_price is None or new_price == prev_price:
        return 0
    data = compute_levels(db, market_tag)
    levels = data.get("levels") or []
    if not levels:
        return 0

    lo, hi = sorted((prev_price, new_price))
    going_up = new_price > prev_price
    direction = "break_above" if going_up else "break_below"
    from zoneinfo import ZoneInfo

    now = datetime.now(timezone.utc)
    ist = now.astimezone(ZoneInfo("Asia/Kolkata"))
    recent_cutoff = now.replace(tzinfo=None) - timedelta(minutes=30)

    written = 0
    for lv in levels:
        if not (lo < lv["price"] < hi):
            continue
        dup = (
            db.query(LevelEvent)
            .filter(
                LevelEvent.market_tag == market_tag,
                LevelEvent.level_price == lv["price"],
                LevelEvent.direction == direction,
                LevelEvent.ts >= recent_cutoff,
            )
            .first()
        )
        if dup is not None:
            continue

        p = lambda v: _fmt_price(market_tag, v)  # noqa: E731
        breakout = going_up and lv["kind"] == "resistance"
        breakdown = (not going_up) and lv["kind"] == "support"

        parts = [
            f"At {ist.strftime('%H:%M IST, %d %b')}, {market_tag} moved {p(prev_price)} → {p(new_price)}, "
            f"crossing {lv['label'].lower()} at {p(lv['price'])}."
        ]
        if lv["proven"]:
            parts.append(
                f"This level had rejected price {lv['strength']} times before — a proven barrier, so clearing it is a genuine break, not noise."
            )
        if breakout:
            parts.append(
                "Scenario: buyers absorbed the selling that had capped price here; broken resistance conventionally flips to support on a retest."
            )
        elif breakdown:
            parts.append(
                "Scenario: sellers overwhelmed the bids that had held this floor; broken support conventionally flips to resistance on a retest."
            )
        elif going_up:
            parts.append("Scenario: price reclaimed this level from below — holding above it keeps the move constructive.")
        else:
            parts.append("Scenario: price slipped back under this level — it sits overhead again until re-taken.")

        beyond = [x for x in levels if (x["price"] > new_price) == going_up and x["price"] != lv["price"]]
        if beyond:
            nxt = min(beyond, key=lambda x: abs(x["price"] - new_price))
            parts.append(
                f"Next computed level in this direction: {nxt['label'].lower()} at {p(nxt['price'])} "
                f"({p(abs(nxt['price'] - new_price))} away)."
            )

        db.add(
            LevelEvent(
                market_tag=market_tag,
                level_price=lv["price"],
                level_label=lv["label"],
                kind=lv["kind"],
                direction=direction,
                proven=bool(lv["proven"]),
                strength=int(lv["strength"]),
                price_before=prev_price,
                price_after=new_price,
                explanation=" ".join(parts),
            )
        )
        written += 1
    return written
