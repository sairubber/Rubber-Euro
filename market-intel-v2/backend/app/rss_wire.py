"""
Publisher RSS + Jina Reader — the source that finally makes real summaries
possible.

Why this exists: Google News RSS hands back an opaque
news.google.com/rss/articles/CBMi... redirect whose target Google encodes and
will not resolve for a bot. Measured result: articles stored with a Google
URL got a real summary 0% of the time. Direct publisher feeds hand back the
publisher's own URL, and once we have that, Jina Reader
(https://r.jina.ai/<url>, free, no key) returns the whole article as clean
markdown — which is what the key-points analyzer needs to work from.

These are the two channels `agent-reach doctor` reports as zero-config ready
on this machine: `rss` (feedparser) and `web` (Jina Reader). Everything else
agent-reach routes to — Twitter, Reddit, LinkedIn, YouTube — needs a browser
login or a CLI backend that isn't installed, so nothing here depends on them.
"""

import html
import logging
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx
from defusedxml import ElementTree

logger = logging.getLogger("market_intel")

JINA_READER = "https://r.jina.ai/"

# Jina rate-limits anonymous use; pace it and treat failure as "no full text"
# rather than an error worth retrying hard.
JINA_PACING_SECONDS = 1.5
JINA_TIMEOUT = 45.0

_http = httpx.Client(
    headers={"User-Agent": "Mozilla/5.0 (compatible; ResearchWire/1.0)"},
    follow_redirects=True,
    limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
)

# (feed url, market, category). Verified reachable and returning items.
# Generic commodity/FX feeds are safe to list wide: every RSS batch passes
# through is_market_news() before storage, so off-topic items never land.
FEEDS: list[tuple[str, str, str]] = [
    # TSR20 / natural rubber
    ("https://www.tyrepress.com/feed/", "TSR20", "trade"),
    ("https://rubberjournalasia.com/feed/", "TSR20", "trade"),
    ("https://www.rubberworld.com/feed/", "TSR20", "trade"),
    ("https://www.investing.com/rss/commodities.rss", "TSR20", "headline"),
    (
        "https://economictimes.indiatimes.com/markets/commodities/rssfeeds/1977021501.cms",
        "TSR20",
        "headline",
    ),
    ("https://www.hellenicshippingnews.com/category/commodities/commodity-news/feed/", "TSR20", "trade"),
    ("https://www.business-standard.com/rss/markets/commodities-10608.rss", "TSR20", "headline"),
    ("https://www.moneycontrol.com/rss/commodities.xml", "TSR20", "headline"),
    # Producer-country business press — is_market_news keeps only the
    # rubber-relevant stories out of these general feeds.
    ("https://www.bangkokpost.com/rss/data/business.xml", "TSR20", "headline"),
    ("https://e.vnexpress.net/rss/business.rss", "TSR20", "headline"),
    ("https://www.freemalaysiatoday.com/category/business/feed/", "TSR20", "headline"),
    ("https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936", "TSR20", "headline"),
    # Shipping/logistics — freight shocks are rubber-supply shocks.
    ("https://gcaptain.com/feed/", "TSR20", "disruption"),
    # EUR/USD
    ("https://www.fxstreet.com/rss/news", "EURUSD", "headline"),
    ("https://www.forexlive.com/feed/news", "EURUSD", "headline"),
    ("https://www.actionforex.com/feed/", "EURUSD", "headline"),
    ("https://www.fxempire.com/api/v1/en/articles/rss/news", "EURUSD", "headline"),
    ("https://www.investing.com/rss/news_1.rss", "EURUSD", "headline"),
    # War / geopolitics wire — conflict headlines that move the majors.
    ("https://www.aljazeera.com/xml/rss/all.xml", "EURUSD", "disruption"),
]

_TAG_RE = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _clean(raw: str) -> str:
    return _WS.sub(" ", html.unescape(_TAG_RE.sub(" ", raw or ""))).strip()


def _parse_date(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(timezone.utc)
    try:
        dt = parsedate_to_datetime(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def fetch_feed(url: str, market: str, category: str, max_items: int = 20) -> list[dict]:
    """Parse one publisher feed. Returns [] on any failure — one dead feed
    must never stop the pass."""
    try:
        resp = _http.get(url, timeout=25)
        resp.raise_for_status()
        root = ElementTree.fromstring(resp.text)
    except Exception:
        logger.warning("RSS feed failed: %s", url)
        return []

    items = []
    for item in root.findall(".//item")[:max_items]:
        title = _clean(item.findtext("title") or "")
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        source = re.sub(r"^www\.", "", (re.match(r"https?://([^/]+)", link) or [None, ""])[1])
        items.append(
            {
                "title": title,
                "description": _clean(item.findtext("description") or "")[:400],
                "url": link,
                "source_name": source,
                "market_tag": market,
                "category": category,
                "published_at": _parse_date(item.findtext("pubDate")),
            }
        )
    return items


def fetch_article_page(url: str) -> str | None:
    """Raw HTML of the article page — used for og:image extraction. Separate
    from Jina because Jina returns markdown with the meta tags stripped, and
    the image lives in those tags."""
    try:
        resp = _http.get(url, timeout=20)
        if resp.status_code != 200:
            return None
        return resp.text[:120000]
    except Exception:
        return None


def fetch_full_text(url: str) -> str | None:
    """Whole article as markdown via Jina Reader. This is what turns a
    headline into bullet points — the meta-description path only ever gave
    one sentence, and only when the publisher bothered to set the tag."""
    try:
        time.sleep(JINA_PACING_SECONDS)
        resp = _http.get(JINA_READER + url, timeout=JINA_TIMEOUT)
        if resp.status_code != 200:
            return None
        text = resp.text
        # Jina prefixes "Title:/URL Source:/Published Time:/Markdown Content:";
        # the analyzer wants the body, not that envelope.
        marker = "Markdown Content:"
        if marker in text:
            text = text.split(marker, 1)[1]
        return text.strip() or None
    except Exception:
        return None


def iter_rss_batches():
    """One batch per feed, so the caller can commit incrementally."""
    for url, market, category in FEEDS:
        yield f"rss {market} {url}", fetch_feed(url, market, category)
