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

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FuturesQuote, PhysicalPrice
from app.sgx import get_front_history, get_sgx_price_as_of

router = APIRouter(tags=["desk"])

# The physical quotes that make sense against a TSR20 futures leg. SMR20 and
# ISNR20 are the Malaysian and Indian technically-specified 20 grades — the
# same spec family the SGX contract settles on. RSS3 rides along because the
# sheet-vs-block premium is the desk's classic grade spread.
BASIS_SPECS = [
    {"location": "KualaLumpur", "grade": "SMR20", "label": "SMR20 · Kuala Lumpur", "kind": "block"},
    {"location": "Kottayam", "grade": "ISNR20", "label": "ISNR20 · Kottayam", "kind": "block"},
    {"location": "Bangkok", "grade": "RSS3", "label": "RSS3 · Bangkok", "kind": "sheet"},
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
            }
        )

    by_grade = {p["grade"]: p for p in physicals}
    spreads = []
    if "RSS3" in by_grade and "SMR20" in by_grade:
        spreads.append(
            {
                "label": "RSS3 − SMR20",
                "note": "Sheet premium over block rubber",
                "value": round(by_grade["RSS3"]["usd_mt"] - by_grade["SMR20"]["usd_mt"], 1),
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
        "physicals": physicals,
        "spreads": spreads,
        "history": history,
        "source": "Physical: Rubber Board of India daily sheets · Futures: SGX",
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
