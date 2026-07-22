import logging
from datetime import datetime, timezone

import httpx

from app.config import NEWS_API_KEY
from app.news_scraper import _detect_country

logger = logging.getLogger("market_intel")

NEWS_API_URL = "https://newsapi.org/v2/everything"

SEARCH_QUERIES: dict[str, str] = {
    "TSR20": '("natural rubber" OR TSR20 OR ANRPC OR SICOM) AND (rubber OR tyre OR export)',
    "EURUSD": '"EUR/USD" OR "euro dollar" OR (ECB AND Fed) OR eurozone forex',
}


def fetch_market_news(market: str, page_size: int = 12) -> list[dict]:
    """Real news headlines from NewsAPI.org. Returns [] if NEWS_API_KEY is not configured."""
    if not NEWS_API_KEY:
        return []

    query = SEARCH_QUERIES.get(market)
    if not query:
        return []

    params = {
        "q": query,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": page_size,
        "apiKey": NEWS_API_KEY,
    }

    try:
        resp = httpx.get(NEWS_API_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.exception("NewsAPI request failed for market %s", market)
        return []

    articles = []
    for a in data.get("articles", []):
        if not a.get("title") or not a.get("url"):
            continue
        try:
            published = datetime.fromisoformat(a["publishedAt"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            published = datetime.now(timezone.utc)

        articles.append(
            {
                "title": a["title"],
                "description": a.get("description") or "",
                "url": a["url"],
                "source_name": (a.get("source") or {}).get("name", ""),
                "market_tag": market,
                "category": "headline",
                "country": _detect_country(f"{a['title']} {a.get('description') or ''}"),
                "published_at": published,
            }
        )
    return articles
