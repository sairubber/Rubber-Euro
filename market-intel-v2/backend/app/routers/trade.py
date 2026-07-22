import threading

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import cache
from app.database import get_db
from app.schemas import (
    BilateralFlowOut,
    EUImportsOut,
    GradeFreshnessOut,
    GradeSeriesOut,
    RunTriggeredOut,
    TradeBalanceOut,
    TradeMoversOut,
    TradeTimelineOut,
)
from app.trade_analysis import (
    DEMAND,
    SUPPLY,
    balance_summary,
    bilateral_flows,
    eu_imports,
    freshness,
    grade_totals,
    movers,
    timeline,
)

router = APIRouter(tags=["trade"])


@router.get("/trade/balance", response_model=TradeBalanceOut)
def get_trade_balance(db: Session = Depends(get_db)):
    """Headline supply vs demand for the latest complete year."""
    if (cached := cache.get("trade:balance")) is not None:
        return cached
    out = TradeBalanceOut(**balance_summary(db))
    cache.put("trade:balance", out, ttl=300)
    return out


@router.get("/trade/supply", response_model=TradeMoversOut)
def get_supply(freq: str = "A", db: Session = Depends(get_db)):
    """Exporting (producing) countries ranked, with change vs prior period."""
    freq = "M" if freq.upper() == "M" else "A"
    key = f"trade:supply:{freq}"
    if (cached := cache.get(key)) is not None:
        return cached
    out = TradeMoversOut(**movers(db, SUPPLY, freq))
    cache.put(key, out, ttl=300)
    return out


@router.get("/trade/demand", response_model=TradeMoversOut)
def get_demand(freq: str = "A", db: Session = Depends(get_db)):
    """Importing (consuming) countries ranked, with change vs prior period."""
    freq = "M" if freq.upper() == "M" else "A"
    key = f"trade:demand:{freq}"
    if (cached := cache.get(key)) is not None:
        return cached
    out = TradeMoversOut(**movers(db, DEMAND, freq))
    cache.put(key, out, ttl=300)
    return out


@router.get("/trade/timeline", response_model=TradeTimelineOut)
def get_timeline(freq: str = "M", db: Session = Depends(get_db)):
    """Per-period frames powering the animated import/export chart."""
    freq = "A" if freq.upper() == "A" else "M"
    key = f"trade:timeline:{freq}"
    if (cached := cache.get(key)) is not None:
        return cached
    out = TradeTimelineOut(**timeline(db, freq))
    cache.put(key, out, ttl=300)
    return out


@router.get("/trade/flows", response_model=list[BilateralFlowOut])
def get_flows(db: Session = Depends(get_db)):
    """Top exporter → importer lanes."""
    if (cached := cache.get("trade:flows")) is not None:
        return cached
    out = [BilateralFlowOut(**f) for f in bilateral_flows(db)]
    cache.put("trade:flows", out, ttl=300)
    return out


@router.get("/trade/grades", response_model=list[GradeSeriesOut])
def get_grades(freq: str = "A", db: Session = Depends(get_db)):
    """Per-grade series: Latex, RSS, TSR/TSNR, cup lumps — separate charts."""
    freq = "M" if freq.upper() == "M" else "A"
    key = f"trade:grades:{freq}"
    if (cached := cache.get(key)) is not None:
        return cached
    out = [GradeSeriesOut(**g) for g in grade_totals(db, freq)]
    cache.put(key, out, ttl=300)
    return out


@router.get("/trade/freshness", response_model=list[GradeFreshnessOut])
def get_freshness(db: Session = Depends(get_db)):
    """What data actually exists per grade — complete vs newest partial."""
    if (cached := cache.get("trade:freshness")) is not None:
        return cached
    out = [GradeFreshnessOut(**f) for f in freshness(db)]
    cache.put("trade:freshness", out, ttl=300)
    return out


@router.get("/trade/eu-imports", response_model=EUImportsOut)
def get_eu_imports(db: Session = Depends(get_db)):
    """EU monthly customs imports by source country (Eurostat). Separate
    from the Comtrade views: EUR not USD, EU27 only, but ~5 months fresh."""
    if (cached := cache.get("trade:eu-imports")) is not None:
        return cached
    out = EUImportsOut(**eu_imports(db))
    cache.put("trade:eu-imports", out, ttl=300)
    return out


@router.post("/trade/refresh", response_model=RunTriggeredOut, status_code=202)
def trigger_trade_refresh():
    from app.scheduler import run_trade_job

    threading.Thread(target=run_trade_job, daemon=True).start()
    return RunTriggeredOut(message="Trade data refresh triggered")
