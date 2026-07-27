from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import cache
from app.climate import PRODUCING_REGIONS
from app.database import get_db
from app.models import ClimateReading, NewsArticle
from app.routers.news import _to_out
from app.schemas import ClimateReadingOut, MarketOutlookOut, NewsArticleOut, RegionSignalOut
from app.signals import compute_market_outlook, compute_region_signals

router = APIRouter(tags=["analytics"])


@router.get("/climate", response_model=list[ClimateReadingOut])
def get_climate(db: Session = Depends(get_db)):
    if (cached := cache.get("climate")) is not None:
        return cached
    # Latest reading per region.
    subq = (
        db.query(ClimateReading.region, func.max(ClimateReading.id).label("max_id"))
        .group_by(ClimateReading.region)
        .subquery()
    )
    rows = db.query(ClimateReading).join(subq, ClimateReading.id == subq.c.max_id).all()

    out = [
        ClimateReadingOut(
            region=r.region,
            country=PRODUCING_REGIONS.get(r.region, {}).get("country", ""),
            lat=PRODUCING_REGIONS.get(r.region, {}).get("lat", 0.0),
            lon=PRODUCING_REGIONS.get(r.region, {}).get("lon", 0.0),
            reading_date=r.reading_date,
            rainfall_mm=r.rainfall_mm,
            rainfall_7d_avg_mm=r.rainfall_7d_avg_mm,
            forecast_7d_mm=getattr(r, "forecast_7d_mm", 0.0) or 0.0,
            disruption_score=r.disruption_score,
            source=r.source,
        )
        for r in rows
    ]
    cache.put("climate", out)
    return out


@router.get("/signals/regions", response_model=list[RegionSignalOut])
def get_region_signals(db: Session = Depends(get_db)):
    """Rule-based composite per producing region: real rainfall anomaly + real
    matched disruption-news count. Not AI, not a price forecast — see signals.py."""
    if (cached := cache.get("signals:regions")) is not None:
        return cached
    out = [RegionSignalOut(**s) for s in compute_region_signals(db)]
    cache.put("signals:regions", out)
    return out


@router.get("/signals/outlook", response_model=MarketOutlookOut)
def get_market_outlook(db: Session = Depends(get_db)):
    if (cached := cache.get("signals:outlook")) is not None:
        return cached
    signals = compute_region_signals(db)
    out = MarketOutlookOut(**compute_market_outlook(signals))
    cache.put("signals:outlook", out)
    return out


@router.get("/supply-alerts", response_model=list[NewsArticleOut])
def get_supply_alerts(db: Session = Depends(get_db)):
    """Real scraped news matching disruption/disease keywords, for TSR20 only
    — Climate & Supply Watch is a rubber-supply page, EUR/USD disruption news
    (recession risk, CPI surprises, etc.) must never appear here. See
    news_scraper.NICHE_QUERIES for the 'disruption' category queries."""
    if (cached := cache.get("supply-alerts")) is not None:
        return cached
    rows = (
        db.query(NewsArticle)
        .filter(NewsArticle.market_tag == "TSR20", NewsArticle.category == "disruption")
        .order_by(NewsArticle.published_at.desc())
        .limit(30)
        .all()
    )
    out = [_to_out(r) for r in rows]
    cache.put("supply-alerts", out)
    return out
