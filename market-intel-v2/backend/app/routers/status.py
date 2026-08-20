from fastapi import APIRouter

from app.config import NEWS_API_KEY, REFRESH_MINUTES
from app.markets import MARKETS
from app.scheduler import get_scrape_status, is_scheduler_running
from app.schemas import StatusOut

router = APIRouter(tags=["status"])


@router.get("/debug/gnews")
def debug_gnews(url: str | None = None):
    """TEMPORARY diagnostic: what does Render's IP actually get back when it
    tries to resolve a Google News link? Reveals whether decode fails on a
    consent wall, an IP block, or something else. Remove after diagnosis."""
    import re

    import httpx

    from app.database import SessionLocal
    from app.models import NewsArticle
    from app.rss_wire import _BROWSER_UA, decode_google_news_url

    if not url:
        db = SessionLocal()
        try:
            row = (
                db.query(NewsArticle)
                .filter(NewsArticle.url.like("%news.google%"))
                .order_by(NewsArticle.published_at.desc())
                .first()
            )
            url = row.url if row else None
        finally:
            db.close()
    if not url:
        return {"error": "no google url available"}

    art = url.split("/articles/", 1)[1].split("?", 1)[0] if "/articles/" in url else ""
    out: dict = {"url": url[:120], "art_prefix": art[:16]}
    try:
        r = httpx.get(
            f"https://news.google.com/rss/articles/{art}",
            headers={"User-Agent": _BROWSER_UA},
            timeout=25,
            follow_redirects=True,
        )
        text = r.text
        out.update(
            status=r.status_code,
            final_url=str(r.url)[:100],
            length=len(text),
            has_sig=bool(re.search(r'data-n-a-sg="', text)),
            has_ts=bool(re.search(r'data-n-a-ts="', text)),
            looks_consent=("consent.google" in text or "Before you continue" in text or "CONSENT" in str(r.url)),
            looks_sorry=("/sorry/" in str(r.url) or "unusual traffic" in text.lower()),
            head=text[:220].replace("\n", " "),
        )
    except Exception as e:
        out["fetch_error"] = repr(e)[:160]
    out["decode_result"] = decode_google_news_url(url)
    return out


@router.get("/status", response_model=StatusOut)
def get_status():
    scrape_status = get_scrape_status()
    return StatusOut(
        scheduler_running=is_scheduler_running(),
        markets=list(MARKETS.keys()),
        refresh_minutes=REFRESH_MINUTES,
        news_api_configured=bool(NEWS_API_KEY),
        last_scrape_at=scrape_status["last_scrape_at"],
        last_scrape_added=scrape_status["last_scrape_added"],
        last_climate_at=scrape_status["last_climate_at"],
    )
