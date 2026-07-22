import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import cache
from app.credibility import credibility_for
from app.database import get_db
from app.markets import MARKETS
from app.models import NewsArticle
from app.scheduler import run_news_scrape_job
from app.schemas import CountryBreakdownItem, NewsArticleOut, RunTriggeredOut

router = APIRouter(tags=["news"])


def _validate_market(market: str) -> str:
    if market not in MARKETS:
        raise HTTPException(status_code=400, detail=f"Unknown market '{market}'. Valid: {list(MARKETS)}")
    return market


def _to_out(a: NewsArticle) -> NewsArticleOut:
    return NewsArticleOut(
        id=a.id,
        title=a.title,
        description=a.description,
        url=a.url,
        source_name=a.source_name,
        market_tag=a.market_tag,
        category=a.category,
        original_language=a.original_language,
        credibility=credibility_for(a.source_name),
        country=a.country,
        key_points=[p for p in (a.key_points or "").split("\n") if p.strip()],
        image_url=a.image_url,
        published_at=a.published_at.isoformat(),
    )


@router.get("/news/latest/{market}", response_model=NewsArticleOut)
def get_latest_news(market: str, db: Session = Depends(get_db)):
    _validate_market(market)
    cache_key = f"latest:{market}"
    if (cached := cache.get(cache_key)) is not None:
        return cached
    article = (
        db.query(NewsArticle)
        .filter(NewsArticle.market_tag == market)
        .order_by(NewsArticle.published_at.desc())
        .first()
    )
    if not article:
        raise HTTPException(status_code=404, detail="No news found for this market yet")
    out = _to_out(article)
    cache.put(cache_key, out)
    return out


@router.get("/news/history/{market}", response_model=list[NewsArticleOut])
def get_news_history(market: str, limit: int = 30, category: str | None = None, db: Session = Depends(get_db)):
    _validate_market(market)
    limit = max(1, min(limit, 200))
    cache_key = f"history:{market}:{limit}:{category or ''}"
    if (cached := cache.get(cache_key)) is not None:
        return cached
    query = db.query(NewsArticle).filter(NewsArticle.market_tag == market)
    if category:
        query = query.filter(NewsArticle.category == category)
    articles = query.order_by(NewsArticle.published_at.desc()).limit(limit).all()
    out = [_to_out(a) for a in articles]
    cache.put(cache_key, out)
    return out


@router.get("/news/item/{article_id}", response_model=NewsArticleOut)
def get_news_item(article_id: int, db: Session = Depends(get_db)):
    article = db.query(NewsArticle).filter(NewsArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return _to_out(article)


@router.get("/news/country-breakdown/{market}", response_model=list[CountryBreakdownItem])
def get_country_breakdown(market: str, category: str = "trade", db: Session = Depends(get_db)):
    """Real article counts by detected country — powers the Trade & Supply pie
    chart. Articles with no detected country are grouped as 'Unspecified' so
    the total always adds up to the full set of matching articles."""
    _validate_market(market)
    cache_key = f"breakdown:{market}:{category}"
    if (cached := cache.get(cache_key)) is not None:
        return cached
    rows = (
        db.query(NewsArticle.country, func.count(NewsArticle.id))
        .filter(NewsArticle.market_tag == market, NewsArticle.category == category)
        .group_by(NewsArticle.country)
        .all()
    )
    items = [CountryBreakdownItem(country=country or "Unspecified", count=count) for country, count in rows]
    items.sort(key=lambda i: i.count, reverse=True)
    cache.put(cache_key, items)
    return items


@router.post("/news/refresh", response_model=RunTriggeredOut, status_code=202)
def trigger_news_refresh():
    threading.Thread(target=run_news_scrape_job, daemon=True).start()
    return RunTriggeredOut(message="News refresh triggered")
