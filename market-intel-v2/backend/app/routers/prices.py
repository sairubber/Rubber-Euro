from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FuturesQuote, FxRate, LevelEvent, PhysicalPrice, PriceTick
from app.prices import compute_levels, get_eurusd_history, get_fx_intraday, iso_utc, quote_out, refresh_fx_rates, upsert_quote
from app.sgx import get_front_history, get_sgx_sync_status, sync_sgx_quotes

router = APIRouter(tags=["prices"])


class QuoteIn(BaseModel):
    market_tag: str = "TSR20"
    contract_month: str
    month_order: int | None = None
    price: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    volume: float | None = None
    close: float | None = None
    open_interest: float | None = None
    oi_change: float | None = None


@router.get("/prices/board")
def get_board(db: Session = Depends(get_db)):
    quotes = (
        db.query(FuturesQuote)
        .filter(FuturesQuote.market_tag == "TSR20")
        .order_by(FuturesQuote.month_order.asc())
        .all()
    )
    shanghai = (
        db.query(FuturesQuote)
        .filter(FuturesQuote.market_tag == "SHNR")
        .order_by(FuturesQuote.month_order.asc())
        .all()
    )
    fx = db.query(FxRate).order_by(FxRate.pair.asc()).all()
    return {
        "sgx_synced_at": get_sgx_sync_status(),
        "quotes": [quote_out(q) for q in quotes],
        "shanghai": [quote_out(q) for q in shanghai],
        "fx": [
            {
                "pair": r.pair,
                "rate": r.rate,
                "prev_rate": r.prev_rate,
                "change_pct": round((r.rate - r.prev_rate) / r.prev_rate * 100, 3) if r.prev_rate else None,
                "fetched_at": iso_utc(r.fetched_at),
            }
            for r in fx
        ],
    }


@router.put("/prices/quote")
def put_quote(payload: QuoteIn, db: Session = Depends(get_db)):
    if payload.market_tag != "TSR20":
        raise HTTPException(status_code=400, detail="Only the TSR20 board is editable")
    q = upsert_quote(db, payload.model_dump())
    return quote_out(q)


@router.get("/prices/ticks/{market_tag}")
def get_ticks(market_tag: str, hours: int = 168, db: Session = Depends(get_db)):
    # Naive UTC on purpose: SQLite hands naive datetimes back, and comparing
    # against an offset-suffixed value is a string comparison there.
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
    ticks = (
        db.query(PriceTick)
        .filter(PriceTick.market_tag == market_tag.upper(), PriceTick.ts >= since)
        .order_by(PriceTick.ts.asc(), PriceTick.id.asc())
        .all()
    )
    return [{"price": t.price, "ts": iso_utc(t.ts)} for t in ticks]


@router.get("/prices/levels/{market_tag}")
def get_levels(market_tag: str, tf: str = "15m", db: Session = Depends(get_db)):
    tag = market_tag.upper()
    if tag not in ("TSR20", "EURUSD"):
        raise HTTPException(status_code=404, detail="Unknown market")
    return compute_levels(db, tag, tf=tf)


@router.get("/prices/level-events/{market_tag}")
def level_events(market_tag: str, limit: int = 30, db: Session = Depends(get_db)):
    events = (
        db.query(LevelEvent)
        .filter(LevelEvent.market_tag == market_tag.upper())
        .order_by(LevelEvent.ts.desc(), LevelEvent.id.desc())
        .limit(min(limit, 100))
        .all()
    )
    return [
        {
            "id": e.id,
            "market_tag": e.market_tag,
            "level_price": e.level_price,
            "level_label": e.level_label,
            "kind": e.kind,
            "direction": e.direction,
            "proven": e.proven,
            "strength": e.strength,
            "price_before": e.price_before,
            "price_after": e.price_after,
            "explanation": e.explanation,
            "ts": iso_utc(e.ts),
        }
        for e in events
    ]


@router.get("/prices/physical")
def physical_prices(db: Session = Depends(get_db)):
    """Latest published day of Rubber Board of India spot prices per market
    location (per 100 kg, INR + USD). Each location carries its own date —
    the international sheet (Bangkok) often publishes on days the Indian
    domestic markets don't."""
    locations = [r[0] for r in db.query(PhysicalPrice.location).distinct().all()]
    out = []
    overall_latest = None
    for loc in sorted(locations):
        latest = (
            db.query(PhysicalPrice.price_date)
            .filter(PhysicalPrice.location == loc)
            .order_by(PhysicalPrice.price_date.desc())
            .first()
        )
        if latest is None:
            continue
        rows = (
            db.query(PhysicalPrice)
            .filter(PhysicalPrice.location == loc, PhysicalPrice.price_date == latest[0])
            .order_by(PhysicalPrice.grade.asc())
            .all()
        )
        out.append({"location": loc, "price_date": latest[0], "rows": [{"grade": r.grade, "inr": r.inr, "usd": r.usd} for r in rows]})
        overall_latest = max(overall_latest or latest[0], latest[0])
    return {
        "price_date": overall_latest,
        "unit": "per 100 kg",
        "source": "Rubber Board of India",
        "locations": out,
    }


@router.get("/prices/tsr20-history")
def tsr20_history(days: int = 90):
    return get_front_history(days)


@router.get("/prices/fx-intraday/{pair}")
def fx_intraday(pair: str):
    return get_fx_intraday(pair.upper())


@router.get("/prices/eurusd-history")
def eurusd_history(days: int = 90):
    return get_eurusd_history(min(days, 365))


@router.post("/prices/refresh-sgx")
def refresh_sgx(db: Session = Depends(get_db)):
    try:
        updated = sync_sgx_quotes(db, force=True)
    except Exception as exc:  # network / Akamai hiccup — board keeps last values
        raise HTTPException(status_code=502, detail=f"SGX fetch failed: {exc}") from exc
    return {"message": f"Synced {updated} contract months from SGX"}


@router.post("/prices/refresh-fx")
def refresh_fx(db: Session = Depends(get_db)):
    updated = refresh_fx_rates(db)
    return {"message": f"Refreshed {updated} FX pairs"}
