"""Desk analytics: physical-vs-futures basis, spreads, and physical history.

Everything here is arithmetic over numbers the desk already stores — SGX
front-month quotes (sgx.py) and Rubber Board of India physical sheets
(physical.py). Nothing is modelled or estimated; a figure that isn't
published simply doesn't appear.

Units: Rubber Board publishes USD per 100 kg; the SGX board holds USD/tonne.
Physical figures are multiplied by 10 here so every number on the basis
screen shares the $/tonne scale.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import IST
from app.database import get_db
from app.enso import get_enso_state
from app.models import ClimateReading, FuturesQuote, FxRate, NewsArticle, PhysicalPrice
from app.models import ThaiFobPrice
from app.sgx import get_front_history, get_sgx_price_as_of
from app.thainr import sync_str20
from app.warrants import get_warrant_stocks

router = APIRouter(tags=["desk"])

# The physical quotes that make sense against a TSR20 futures leg. SMR20 and
# ISNR20 are the Malaysian and Indian technically-specified 20 grades — the
# same spec family the SGX contract settles on. The desk trades TSR20 only,
# so sheet grades (RSS) deliberately stay off this screen.
BASIS_SPECS = [
    {"location": "KualaLumpur", "grade": "SMR20", "label": "SMR20 · Kuala Lumpur", "kind": "block"},
    {"location": "Kottayam", "grade": "ISNR20", "label": "ISNR20 · Kottayam", "kind": "block"},
]


def _latest_physical(db: Session, location: str, grade: str) -> PhysicalPrice | None:
    return (
        db.query(PhysicalPrice)
        .filter(PhysicalPrice.location == location, PhysicalPrice.grade == grade, PhysicalPrice.usd.isnot(None))
        .order_by(PhysicalPrice.price_date.desc())
        .first()
    )


def _physical_series(db: Session, location: str, grade: str, days: int) -> dict[str, float]:
    rows = (
        db.query(PhysicalPrice.price_date, PhysicalPrice.usd)
        .filter(PhysicalPrice.location == location, PhysicalPrice.grade == grade, PhysicalPrice.usd.isnot(None))
        .order_by(PhysicalPrice.price_date.desc())
        .limit(days)
        .all()
    )
    return {d: round(u * 10, 1) for d, u in rows}


@router.get("/desk/basis")
def get_basis(days: int = 90, db: Session = Depends(get_db)):
    """Physical FOB/spot quotes against the SGX TSR20 front month, all in
    $/tonne. Basis = physical − futures; positive means physical trades at a
    premium (tight spot market), negative means futures carry a premium."""
    front = (
        db.query(FuturesQuote)
        .filter(FuturesQuote.market_tag == "TSR20")
        .order_by(FuturesQuote.month_order.asc())
        .first()
    )
    if front is None:
        raise HTTPException(status_code=503, detail="SGX board is empty — no futures leg to compute basis against")

    # Shanghai INE NR front month, converted to USD at the live CNYUSD rate
    # purely for display — the CNY figure travels alongside so nothing is
    # hidden behind the conversion.
    sh_front = (
        db.query(FuturesQuote)
        .filter(FuturesQuote.market_tag == "SHNR")
        .order_by(FuturesQuote.month_order.asc())
        .first()
    )
    cnyusd = db.query(FxRate).filter(FxRate.pair == "CNYUSD").first()
    shanghai = None
    if sh_front is not None and cnyusd is not None and cnyusd.rate:
        shanghai = {
            "front_month": sh_front.contract_month,
            "cny_price": sh_front.price,
            "usd_price": round(sh_front.price * cnyusd.rate, 1),
            "fx_rate": cnyusd.rate,
        }

    physicals = []
    for spec in BASIS_SPECS:
        row = _latest_physical(db, spec["location"], spec["grade"])
        if row is None:
            continue
        usd_mt = round(row.usd * 10, 1)
        physicals.append(
            {
                **spec,
                "usd_mt": usd_mt,
                "price_date": row.price_date,
                "basis": round(usd_mt - front.price, 1),
                "basis_ine": round(usd_mt - shanghai["usd_price"], 1) if shanghai else None,
            }
        )

    # Thailand leg — TRA's own FOB Laem Chabang offer, THB converted at the
    # live USDTHB rate (per-date at fetch time for the stored history).
    str20 = sync_str20(db)
    if str20 and str20.get("usd_mt"):
        physicals.insert(
            0,
            {
                "location": "Laem Chabang",
                "grade": "STR20",
                "label": "STR20 · Laem Chabang FOB",
                "kind": "block",
                "usd_mt": str20["usd_mt"],
                "price_date": str20["price_date"],
                "basis": round(str20["usd_mt"] - front.price, 1),
                "basis_ine": round(str20["usd_mt"] - shanghai["usd_price"], 1) if shanghai else None,
            },
        )

    by_grade = {p["grade"]: p for p in physicals}
    spreads = []
    if "STR20" in by_grade and "SMR20" in by_grade:
        spreads.append(
            {
                "label": "STR20 − SMR20",
                "note": "Thailand vs Malaysia origin spread (same spec)",
                "value": round(by_grade["STR20"]["usd_mt"] - by_grade["SMR20"]["usd_mt"], 1),
            }
        )
    if "ISNR20" in by_grade and "SMR20" in by_grade:
        spreads.append(
            {
                "label": "ISNR20 − SMR20",
                "note": "India vs Malaysia origin spread (same spec)",
                "value": round(by_grade["ISNR20"]["usd_mt"] - by_grade["SMR20"]["usd_mt"], 1),
            }
        )

    # History: for each date a physical printed, pair it with the most recent
    # SGX settlement on or before that date. Dates without a physical print
    # (weekends, board holidays) simply don't produce a point.
    settle_by_date = {p["ts"][:10]: p["price"] for p in get_front_history(days)}
    settle_dates = sorted(settle_by_date)
    series = {spec["grade"]: _physical_series(db, spec["location"], spec["grade"], days) for spec in BASIS_SPECS}
    series["STR20"] = {
        r.price_date: r.usd_mt
        for r in db.query(ThaiFobPrice).filter(ThaiFobPrice.usd_mt.isnot(None)).order_by(ThaiFobPrice.price_date.desc()).limit(days)
    }

    def settle_on_or_before(date: str) -> float | None:
        candidate = None
        for d in settle_dates:
            if d > date:
                break
            candidate = d
        return settle_by_date[candidate] if candidate else None

    all_dates = sorted({d for s in series.values() for d in s})
    history = []
    for date in all_dates:
        settle = settle_on_or_before(date)
        if settle is None:
            continue
        point = {"date": date, "sgx_settle": settle}
        for grade, s in series.items():
            if date in s:
                point[grade.lower()] = s[date]
                point[f"basis_{grade.lower()}"] = round(s[date] - settle, 1)
        history.append(point)

    return {
        "front_month": front.contract_month,
        "sgx_price": front.price,
        "sgx_close": front.close,
        "sgx_price_as_of": get_sgx_price_as_of(),
        "unit": "USD/tonne",
        "shanghai": shanghai,
        "physicals": physicals,
        "spreads": spreads,
        "history": history,
        "source": "Physical: Rubber Board of India daily sheets · Futures: SGX",
    }


@router.get("/desk/vessels")
def desk_vessels(db: Session = Depends(get_db)):
    """Live AIS snapshot per rubber-port box, plus the 7-day congestion trend
    from the stored ten-minute counts. Ships, not cargoes — see the honesty
    note in app/vessels.py."""
    from app.models import VesselCount
    from app.vessels import get_vessel_snapshot

    snap = get_vessel_snapshot()
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    for p in snap["ports"]:
        rows = (
            db.query(VesselCount.ts, VesselCount.anchored_commodity)
            .filter(VesselCount.port == p["port"], VesselCount.ts >= since)
            .order_by(VesselCount.ts.asc())
            .all()
        )
        stride = max(len(rows) // 72, 1)  # ≤ ~72 sparkline points
        points = [{"ts": r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0]), "anchored_commodity": r[1]} for r in rows[::stride]]
        avg = round(sum(r[1] for r in rows) / len(rows), 1) if rows else None
        pct = round((p["anchored_commodity"] - avg) / avg * 100, 1) if avg else None
        p["trend"] = {"avg_7d": avg, "pct_vs_avg": pct, "samples": len(rows), "points": points}
    return snap


@router.get("/desk/spread-history")
def spread_history(days: int = 180):
    """SGX front settlement vs INE NR0 settlement (converted at each date's
    own ECB USD/CNY reference rate) — the cross-exchange spread over time."""
    from app.ine_history import get_nr0_kline, get_usdcny_by_date

    days = min(days, 365)
    sgx_by_date = {p["ts"][:10]: p["price"] for p in get_front_history(days)}
    fx_by_date = get_usdcny_by_date(days)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()

    fx_dates = sorted(fx_by_date)

    def fx_on_or_before(d: str) -> float | None:
        candidate = None
        for fd in fx_dates:
            if fd > d:
                break
            candidate = fd
        return fx_by_date[candidate] if candidate else None

    out = []
    for p in get_nr0_kline():
        d = p["date"]
        if d < since or d not in sgx_by_date:
            continue
        rate = fx_on_or_before(d)
        if not rate:
            continue
        ine_usd = round(p["settle"] / rate, 1)
        out.append(
            {
                "date": d,
                "sgx": sgx_by_date[d],
                "ine_cny": p["settle"],
                "usdcny": round(rate, 4),
                "ine_usd": ine_usd,
                "spread": round(sgx_by_date[d] - ine_usd, 1),
            }
        )
    return {
        "note": "Settlement-vs-settlement; INE converted at each date's own ECB USD/CNY reference rate.",
        "series": out,
    }


@router.get("/desk/ine-seasonality")
def ine_seasonality():
    """Multi-year INE NR monthly seasonality envelope — TSR20 data, no
    sheet-grade proxy."""
    from app.ine_history import seasonality_envelope

    return seasonality_envelope()


@router.get("/desk/portwatch")
def desk_portwatch(days: int = 60):
    """IMF PortWatch satellite-AIS daily activity for the rubber ports —
    real daily port calls and cargo tonnage estimates, ~3-5 day lag."""
    from app.portwatch import get_port_activity

    return {
        "source": "IMF PortWatch (satellite AIS, open data) — cargo estimates are all-cargo, not rubber-specific",
        "ports": get_port_activity(days),
    }


@router.get("/desk/vessel-search")
def vessel_search(q: str):
    """In-app search over the live AIS store (ships currently in the
    subscribed boxes). No global lookup — that data is paid."""
    from app.vessels import search_vessels

    return {"query": q, "matches": search_vessels(q)}


@router.get("/desk/warrant-stocks")
def warrant_stocks(days: int = 180):
    """China exchange rubber inventories — daily tonnes + change, oldest →
    newest, exchange figures via East Money's public mirror.

    nr = INE TSR20 (the desk's contract). ru = SHFE whole-latex, carried as
    China rubber-complex CONTEXT — it is not TSR20-deliverable, but China's
    onshore balance moves both boards. Singapore/SICOM deliverable stocks
    are not published freely by SGX — absent rather than estimated."""
    return {
        "unit": "tonnes",
        "source": "Exchange warrant figures via East Money datacenter (free public mirror)",
        "contract": "INE NR (TSR20, 上期能源-20号胶)",
        "series": get_warrant_stocks("nr", days),
        "ru": {
            "contract": "SHFE RU (whole-latex — China rubber-complex context, NOT TSR20)",
            "series": get_warrant_stocks("RU", days),
        },
        "sg_note": "SGX/SICOM deliverable warehouse stocks are not published freely — no figure is shown rather than an estimate.",
    }


@router.get("/desk/risk")
def desk_risk(db: Session = Depends(get_db)):
    """Vol & risk pack — all arithmetic over the settlement series the desk
    already fetches, plus keyless FRED context (Brent for the substitution
    watch, US Freight TSI as a tire-demand proxy)."""
    import math

    from app.ine_history import get_nr0_kline
    from app.macro import fred_series

    def daily_returns(closes: list[float]) -> list[float]:
        return [math.log(b / a) for a, b in zip(closes, closes[1:]) if a > 0 and b > 0]

    def ann_vol(rets: list[float]) -> float | None:
        if len(rets) < 5:
            return None
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        return round(math.sqrt(var) * math.sqrt(252) * 100, 1)

    sgx_hist = get_front_history(365)
    sgx_closes = [p["price"] for p in sgx_hist]
    sgx_dates = [p["ts"][:10] for p in sgx_hist]
    sgx_rets = daily_returns(sgx_closes)

    # Max drawdown over ~6 months of settlements.
    dd = 0.0
    peak = None
    for c in sgx_closes[-126:]:
        peak = c if peak is None or c > peak else peak
        dd = min(dd, (c - peak) / peak)

    nr0 = get_nr0_kline()
    # ATR(14) from NR0 OHLC — SGX free history carries settlements only.
    trs = []
    for prev, cur in zip(nr0[-15:], nr0[-14:]):
        trs.append(max(cur["settle"], prev["settle"]) - min(cur["settle"], prev["settle"]))
    ine_closes = [p["settle"] for p in nr0]
    ine_rets = daily_returns(ine_closes)

    # Brent + correlation with SGX daily returns on matched dates.
    brent = fred_series("DCOILBRENTEU", 400)
    brent_by_date = {p["date"]: p["value"] for p in brent}
    matched_sgx, matched_brent = [], []
    prev_s = prev_b = None
    for d, s in zip(sgx_dates, sgx_closes):
        b = brent_by_date.get(d)
        if b is None:
            continue
        if prev_s and prev_b:
            matched_sgx.append(math.log(s / prev_s))
            matched_brent.append(math.log(b / prev_b))
        prev_s, prev_b = s, b
    corr = None
    if len(matched_sgx) >= 20:
        xs, ys = matched_sgx[-60:], matched_brent[-60:]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
        den = math.sqrt(sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys))
        corr = round(num / den, 2) if den else None

    tsi = fred_series("TSIFRGHT", 36)
    tsi_yoy = None
    if len(tsi) >= 13:
        tsi_yoy = round((tsi[-1]["value"] - tsi[-13]["value"]) / tsi[-13]["value"] * 100, 1)

    front = (
        db.query(FuturesQuote).filter(FuturesQuote.market_tag == "TSR20").order_by(FuturesQuote.month_order.asc()).first()
    )
    brent_last = brent[-1] if brent else None

    return {
        "sgx": {
            "front_price": front.price if front else None,
            "vol_20d_pct": ann_vol(sgx_rets[-20:]),
            "vol_60d_pct": ann_vol(sgx_rets[-60:]),
            "max_drawdown_6m_pct": round(dd * 100, 1),
            "last_return_pct": round(sgx_rets[-1] * 100, 2) if sgx_rets else None,
            "returns_60d": [round(r * 100, 2) for r in sgx_rets[-60:]],
        },
        "ine": {
            "vol_20d_pct": ann_vol(ine_rets[-20:]),
            "atr14_cny": round(sum(trs) / len(trs), 0) if trs else None,
        },
        "brent": {
            "last": brent_last["value"] if brent_last else None,
            "date": brent_last["date"] if brent_last else None,
            "nr_brent_ratio": round(front.price / brent_last["value"], 1) if front and brent_last else None,
            "corr_60d": corr,
        },
        "tsi": {
            "last": tsi[-1]["value"] if tsi else None,
            "date": tsi[-1]["date"] if tsi else None,
            "yoy_pct": tsi_yoy,
            "series": tsi,
        },
        "contracts": {
            "sgx_tf_lot_tonnes": 5,
            "ine_nr_lot_tonnes": 10,
        },
        "note": (
            "Realized vol = stdev of daily log returns × √252, from SGX settlements. ATR14 from INE NR0 settlements "
            "(SGX free history has no OHLC). Brent is the substitution-economics driver (synthetic rubber is a crude "
            "derivative) — context only, this desk trades NR. TSI = US Freight Transportation Services Index, a free "
            "tire-demand proxy. All series keyless public data."
        ),
    }


def _curve_shape(quotes: list[FuturesQuote]) -> str:
    if len(quotes) < 2:
        return "Flat"
    diff = quotes[-1].price - quotes[0].price
    if abs(diff) < 1:
        return "Flat"
    return "Contango" if diff > 0 else "Backwardation"


@router.get("/desk/bulletin")
def desk_bulletin(db: Session = Depends(get_db)):
    """Executive morning briefing — every number assembled from data the desk
    already stores or fetches from free official sources. Rule-based text
    only; nothing here is model-written."""
    from zoneinfo import ZoneInfo

    now_ist = datetime.now(ZoneInfo(IST))

    sgx = db.query(FuturesQuote).filter(FuturesQuote.market_tag == "TSR20").order_by(FuturesQuote.month_order.asc()).all()
    shn = db.query(FuturesQuote).filter(FuturesQuote.market_tag == "SHNR").order_by(FuturesQuote.month_order.asc()).all()
    cnyusd = db.query(FxRate).filter(FxRate.pair == "CNYUSD").first()

    futures = None
    if sgx:
        front = sgx[0]
        ine_usd = round(shn[0].price * cnyusd.rate, 1) if shn and cnyusd and cnyusd.rate else None
        futures = {
            "sgx_front_month": front.contract_month,
            "sgx_price": front.price,
            "sgx_close": front.close,
            "sgx_change": round(front.price - front.close, 1) if front.close else None,
            "sgx_curve": _curve_shape(sgx),
            "ine_front_cny": shn[0].price if shn else None,
            "ine_front_usd": ine_usd,
            "ine_curve": _curve_shape(shn),
            "exchange_spread": round(front.price - ine_usd, 1) if ine_usd else None,
            "sgx_price_as_of": get_sgx_price_as_of(),
        }

    physicals = []
    if sgx:
        str20 = sync_str20(db)
        if str20 and str20.get("usd_mt"):
            physicals.append(
                {
                    "label": "STR20 · Laem Chabang FOB",
                    "grade": "STR20",
                    "usd_mt": str20["usd_mt"],
                    "price_date": str20["price_date"],
                    "basis": round(str20["usd_mt"] - sgx[0].price, 1),
                }
            )
        for spec in BASIS_SPECS:
            row = _latest_physical(db, spec["location"], spec["grade"])
            if row is None:
                continue
            usd_mt = round(row.usd * 10, 1)
            physicals.append({**spec, "usd_mt": usd_mt, "price_date": row.price_date, "basis": round(usd_mt - sgx[0].price, 1)})

    fx = [
        {"pair": r.pair, "rate": r.rate, "change_pct": round((r.rate - r.prev_rate) / r.prev_rate * 100, 3) if r.prev_rate else None}
        for r in db.query(FxRate).order_by(FxRate.pair.asc()).all()
    ]

    stocks = None
    series = get_warrant_stocks("nr", 180)
    if series:
        latest = series[-1]
        month_ago = series[max(len(series) - 21, 0)]
        lows = min(p["tonnes"] for p in series)
        highs = max(p["tonnes"] for p in series)
        stocks = {
            "date": latest["date"],
            "tonnes": latest["tonnes"],
            "daily_change": latest["change"],
            "month_change": latest["tonnes"] - month_ago["tonnes"],
            "window_low": lows,
            "window_high": highs,
            # 0 = at the window low, 100 = at the high — a position, not a
            # 5-year seasonal Z-score (free history only reaches ~3 months).
            "window_position_pct": round((latest["tonnes"] - lows) / (highs - lows) * 100, 1) if highs > lows else None,
        }

    month = now_ist.month
    if 2 <= month <= 4:
        season = "Wintering (Feb–Apr): leaf shedding, tapping typically down 50–70%"
    elif month >= 10:
        season = "Peak tapping (Oct–Dec): maximum production window"
    else:
        season = "Normal tapping (between wintering and the Oct–Dec peak)"

    rain_hit = []
    for region in [r[0] for r in db.query(ClimateReading.region).distinct().all()]:
        latest_r = (
            db.query(ClimateReading)
            .filter(ClimateReading.region == region)
            .order_by(ClimateReading.reading_date.desc())
            .first()
        )
        if latest_r and latest_r.rainfall_mm > 2:
            rain_hit.append({"region": region, "rainfall_mm": latest_r.rainfall_mm})

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    headlines = [
        {"title": a.title, "source": a.source_name, "url": a.url}
        for a in db.query(NewsArticle)
        .filter(NewsArticle.market_tag == "TSR20", NewsArticle.published_at >= since)
        .order_by(NewsArticle.published_at.desc())
        .limit(5)
        .all()
    ]

    return {
        "generated_at": now_ist.isoformat(),
        "edition": now_ist.strftime("%A, %d %B %Y"),
        "futures": futures,
        "physicals": physicals,
        "fx": fx,
        "stocks": stocks,
        "tapping_season": season,
        "rain_hit": rain_hit,
        "enso": get_enso_state(),
        "headlines": headlines,
    }


@router.get("/desk/thai-fob")
def thai_fob(days: int = 120, db: Session = Depends(get_db)):
    """TRA STR20 FOB Laem Chabang — latest print plus stored history (each
    date converted at that day's fetched USDTHB rate)."""
    latest = sync_str20(db)
    rows = (
        db.query(ThaiFobPrice)
        .order_by(ThaiFobPrice.price_date.desc())
        .limit(min(days, 365))
        .all()
    )
    return {
        "source": "Thai Rubber Association offer price, FOB Laem Chabang",
        "latest": latest,
        "series": [{"price_date": r.price_date, "thb_kg": r.thb_kg, "usd_mt": r.usd_mt} for r in reversed(rows)],
    }


@router.get("/desk/verdict")
def desk_verdict(db: Session = Depends(get_db)):
    """Institutional-grade signal aggregation — every signal the desk already
    computes, each with an explicit direction, weight and reason, combined
    into a transparent weighted score. Pure rules over real data: the weights
    are visible, the arithmetic is stated, and nothing is model-written.
    Research display, not investment advice."""
    import math

    from app.ine_history import get_nr0_kline, get_usdcny_by_date, seasonality_envelope
    from app.macro import fred_series

    signals: list[dict] = []

    def add(name: str, reading: str, direction: int, weight: int, reason: str, group: str) -> None:
        signals.append({"name": name, "reading": reading, "direction": direction, "weight": weight, "reason": reason, "group": group})

    # ── Price & term structure ────────────────────────────────────────
    for tag, label, weight in (("TSR20", "SGX curve", 2), ("SHNR", "INE curve", 1)):
        qs = db.query(FuturesQuote).filter(FuturesQuote.market_tag == tag).order_by(FuturesQuote.month_order.asc()).all()
        if len(qs) >= 2:
            diff = qs[-1].price - qs[0].price
            shape = "Backwardation" if diff < -1 else "Contango" if diff > 1 else "Flat"
            direction = 1 if shape == "Backwardation" else -1 if shape == "Contango" else 0
            add(label, shape, direction, weight, "Backwardation = spot bid over deferred (nearby tightness); contango = comfortable nearby supply.", "price")

    # Price momentum — 20-session settlement trend. Trend is information:
    # persistent moves reflect the balance actually clearing tighter/looser.
    hist = get_front_history(90)
    if len(hist) >= 21:
        chg = (hist[-1]["price"] - hist[-21]["price"]) / hist[-21]["price"] * 100
        add("Price momentum (20 sessions)", f"{chg:+.1f}%", 1 if chg > 2 else -1 if chg < -2 else 0, 2,
            "Settlement 20 sessions ago vs latest; ±2% is the noise band.", "price")

    # OI conviction — who is entering on the move. Rising OI on a rally =
    # fresh longs (conviction); rising OI on a selloff = fresh shorts.
    front_q = db.query(FuturesQuote).filter(FuturesQuote.market_tag == "TSR20").order_by(FuturesQuote.month_order.asc()).first()
    if front_q and front_q.close:
        px_chg = front_q.price - front_q.close
        oi_chg = front_q.oi_change
        if oi_chg > 0 and px_chg > 0:
            add("OI conviction", f"OI {oi_chg:+,.0f} on price {px_chg:+,.0f}", 1, 1, "Open interest building on a rally = fresh longs entering.", "price")
        elif oi_chg > 0 and px_chg < 0:
            add("OI conviction", f"OI {oi_chg:+,.0f} on price {px_chg:+,.0f}", -1, 1, "Open interest building on a selloff = fresh shorts entering.", "price")
        else:
            add("OI conviction", f"OI {oi_chg:+,.0f}, price {px_chg:+,.0f}", 0, 1, "Falling or flat OI = positions closing, no fresh conviction either way.", "price")

    # ── Inventories ───────────────────────────────────────────────────
    nr_series = get_warrant_stocks("nr", 180)
    if len(nr_series) >= 21:
        month_pct = (nr_series[-1]["tonnes"] - nr_series[-21]["tonnes"]) / nr_series[-21]["tonnes"] * 100
        direction = 1 if month_pct < -10 else -1 if month_pct > 10 else 0
        add("INE NR warrants", f"{nr_series[-1]['tonnes']:,} t ({month_pct:+.1f}% /~month)", direction, 3,
            "Deliverable stock draining >10%/month = nearby tightness; building = deliverable surplus. Highest weight — it is TSR20's own delivery pool.", "inventory")
    ru_series = get_warrant_stocks("RU", 180)
    if len(ru_series) >= 21:
        month_pct = (ru_series[-1]["tonnes"] - ru_series[-21]["tonnes"]) / ru_series[-21]["tonnes"] * 100
        direction = 1 if month_pct < -10 else -1 if month_pct > 10 else 0
        add("SHFE RU warrants (context)", f"{ru_series[-1]['tonnes']:,} t ({month_pct:+.1f}% /~month)", direction, 1,
            "Whole-latex pool, not TSR20 — but China's onshore rubber balance moves both boards.", "inventory")

    # ── Physical basis ────────────────────────────────────────────────
    front = db.query(FuturesQuote).filter(FuturesQuote.market_tag == "TSR20").order_by(FuturesQuote.month_order.asc()).first()
    str20 = sync_str20(db)
    if front and str20 and str20.get("usd_mt"):
        basis = str20["usd_mt"] - front.price
        direction = 1 if basis > 50 else -1 if basis < -50 else 0
        add("STR20 physical basis", f"{basis:+.0f} $/t vs SGX front", direction, 2,
            "Physical premium >$50 = origin sellers command over paper (tight spot); discount = paper over physical.", "supply")

    # ── Seasonality anomaly ───────────────────────────────────────────
    seas = seasonality_envelope()
    if seas["envelope"] and seas["current_year"]:
        cur = seas["current_year"][-1]
        env = next((e for e in seas["envelope"] if e["month"] == cur["month"]), None)
        if env:
            if cur["mean"] > env["max"]:
                add("Seasonality position", f"month mean ¥{cur['mean']:,} ABOVE {seas['years']}y max ¥{env['max']:,}", 1, 1,
                    "Price above the historical envelope for this month = off-season strength, not normal seasonal shape.", "price")
            elif cur["mean"] < env["min"]:
                add("Seasonality position", f"month mean ¥{cur['mean']:,} BELOW {seas['years']}y min ¥{env['min']:,}", -1, 1,
                    "Price below the historical envelope = off-season weakness.", "price")
            else:
                add("Seasonality position", f"inside {seas['years']}y envelope", 0, 1, "Current price sits within normal seasonal range.", "price")

    # ── Supply-side weather ───────────────────────────────────────────
    rain_hit = 0
    for region in [r[0] for r in db.query(ClimateReading.region).distinct().all()]:
        latest_r = db.query(ClimateReading).filter(ClimateReading.region == region).order_by(ClimateReading.reading_date.desc()).first()
        if latest_r and latest_r.rainfall_mm > 2:
            rain_hit += 1
    add("Tapping weather", f"{rain_hit} belts above 2 mm today", 1 if rain_hit >= 3 else 0, 2,
        "3+ producing belts rained out = lost tapping mornings across origins; supply-supportive.", "supply")

    month = datetime.now(timezone.utc).month
    if 2 <= month <= 4:
        add("Tapping season", "Wintering (Feb–Apr)", 1, 1, "Leaf-shedding season cuts output 50–70% across SE Asia.", "supply")
    elif month >= 10:
        add("Tapping season", "Peak (Oct–Dec)", -1, 1, "Maximum production window loosens supply.", "supply")
    else:
        add("Tapping season", "Normal", 0, 1, "Between wintering and the Oct–Dec peak.", "supply")

    enso = get_enso_state()
    if enso:
        direction = 1 if abs(enso["anomaly"]) >= 0.5 else 0
        add("ENSO", f"ONI {enso['anomaly']:+.2f} ({enso['season']} {enso['year']})", direction, 1,
            "Either active phase threatens yields — El Niño via drought, La Niña via flooded tapping days.", "supply")

    # ── News keyword pulse (last 48h, transparent word lists) ─────────
    BULL_WORDS = ("shortage", "disruption", "flood", "delay", "strike", "curb", "output fall", "production drop",
                  "tight", "drought", "disease", "export ban", "supply cut")
    BEAR_WORDS = ("surplus", "glut", "weak demand", "oversupply", "slowdown", "stockpile build", "demand fall",
                  "output rise", "production increase", "bumper")
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=48)
    heads = [a.title.lower() + " " + (a.description or "").lower()
             for a in db.query(NewsArticle).filter(NewsArticle.market_tag == "TSR20", NewsArticle.published_at >= since).all()]
    bull = sum(any(w in h for w in BULL_WORDS) for h in heads)
    bear = sum(any(w in h for w in BEAR_WORDS) for h in heads)
    net = bull - bear
    add("News keyword pulse (48h)", f"{bull} supply-risk vs {bear} surplus/demand-weak stories",
        1 if net >= 2 else -1 if net <= -2 else 0, 2,
        "Keyword counting over real stored headlines — word lists are fixed and shown in the method note; not AI sentiment.", "supply")

    # ── Demand & substitution ─────────────────────────────────────────
    tsi = fred_series("TSIFRGHT", 36)
    if len(tsi) >= 13:
        yoy = (tsi[-1]["value"] - tsi[-13]["value"]) / tsi[-13]["value"] * 100
        add("US freight (tire demand proxy)", f"TSI {tsi[-1]['value']:.1f} ({yoy:+.1f}% yoy)",
            1 if yoy > 1 else -1 if yoy < -1 else 0, 1,
            "Heavy-truck freight wears the highest-NR-content tires; ±1% yoy is the noise band.", "demand")

    brent = fred_series("DCOILBRENTEU", 60)
    if len(brent) >= 22:
        chg = (brent[-1]["value"] - brent[-22]["value"]) / brent[-22]["value"] * 100
        add("Brent 1m (substitution)", f"${brent[-1]['value']:.0f} ({chg:+.1f}%/month)",
            1 if chg > 5 else -1 if chg < -5 else 0, 1,
            "Crude up = synthetic rubber dearer = NR relatively attractive; ±5%/month threshold.", "demand")

    # ── Composite ─────────────────────────────────────────────────────
    total_weight = sum(s["weight"] for s in signals)
    raw = sum(s["direction"] * s["weight"] for s in signals)
    score = round(raw / total_weight * 100) if total_weight else 0
    active = [s for s in signals if s["direction"] != 0]
    agree = 0.0
    if active:
        pos = sum(s["weight"] for s in active if s["direction"] > 0)
        neg = sum(s["weight"] for s in active if s["direction"] < 0)
        agree = round(abs(pos - neg) / (pos + neg) * 100) if pos + neg else 0

    if score >= 35:
        verdict = "Supply-tight — bullish tilt"
    elif score >= 12:
        verdict = "Lean bullish"
    elif score <= -35:
        verdict = "Surplus — bearish tilt"
    elif score <= -12:
        verdict = "Lean bearish"
    else:
        verdict = "Mixed / neutral"

    groups = {}
    for g in ("price", "inventory", "supply", "demand"):
        gs = [s for s in signals if s["group"] == g]
        gw = sum(s["weight"] for s in gs)
        groups[g] = {
            "net": round(sum(s["direction"] * s["weight"] for s in gs) / gw * 100) if gw else 0,
            "count": len(gs),
        }

    supporting = sorted([s for s in signals if s["direction"] > 0], key=lambda s: -s["weight"])
    opposing = sorted([s for s in signals if s["direction"] < 0], key=lambda s: -s["weight"])
    summary = ""
    if supporting:
        summary += "For: " + "; ".join(f"{s['name'].lower()} ({s['reading']})" for s in supporting[:3]) + "."
    if opposing:
        summary += " Against: " + "; ".join(f"{s['name'].lower()} ({s['reading']})" for s in opposing[:2]) + "."
    if not summary:
        summary = "No active signals — everything inside its noise band."

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "verdict": verdict,
        "score": score,
        "signal_agreement_pct": agree,
        "summary": summary,
        "groups": groups,
        "signals": signals,
        "method": (
            "Score = Σ(direction × weight) / Σ(weights) × 100, bands: ≥+35 bullish tilt, +12..+35 lean bullish, "
            "−12..+12 mixed, −35..−12 lean bearish, ≤−35 bearish tilt. Directions are fixed threshold rules stated "
            "per signal; weights are fixed and shown. Keyword lists — supply-risk: " + ", ".join(BULL_WORDS) +
            " · surplus/demand-weak: " + ", ".join(BEAR_WORDS) + ". Rule-based research display over real public "
            "data; NOT a forecast, NOT investment advice."
        ),
    }


@router.get("/desk/physical-history")
def physical_history(location: str, grade: str, days: int = 90, db: Session = Depends(get_db)):
    """Raw published series for one (location, grade) — for sparklines on the
    Origin Desk. Ordered oldest → newest."""
    rows = (
        db.query(PhysicalPrice)
        .filter(PhysicalPrice.location == location, PhysicalPrice.grade == grade)
        .order_by(PhysicalPrice.price_date.desc())
        .limit(min(days, 365))
        .all()
    )
    return [
        {"price_date": r.price_date, "inr": r.inr, "usd": r.usd}
        for r in reversed(rows)
    ]
