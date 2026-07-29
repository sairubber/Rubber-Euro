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
from app.warrants import get_nr_warrant_stocks

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


@router.get("/desk/warrant-stocks")
def warrant_stocks(days: int = 180):
    """INE NR (TSR20) on-warrant warehouse stocks — daily tonnes + change,
    oldest → newest. Exchange figures via East Money's public mirror."""
    series = get_nr_warrant_stocks(days)
    return {
        "unit": "tonnes",
        "contract": "INE NR (TSR20, 上期能源-20号胶)",
        "source": "Exchange warrant figures via East Money datacenter (free public mirror)",
        "series": series,
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
    series = get_nr_warrant_stocks(180)
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
