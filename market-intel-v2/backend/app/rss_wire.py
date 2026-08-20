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
import json
import logging
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

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
    # Indian commodities press — Kottayam/rubber-board coverage lives here.
    ("https://www.thehindubusinessline.com/markets/commodities/feeder/default.rss", "TSR20", "headline"),
    # Auto/tire industry press — the demand side of the NR balance. The
    # is_market_news gate keeps only the rubber/tire-relevant stories out of
    # these general auto feeds.
    ("https://carnewschina.com/feed/", "TSR20", "headline"),
    ("https://www.paultan.org/feed/", "TSR20", "headline"),
    ("https://www.electrive.com/feed/", "TSR20", "headline"),
    ("https://www.just-auto.com/feed/", "TSR20", "headline"),
    # Shipping/logistics — freight shocks are rubber-supply shocks.
    ("https://gcaptain.com/feed/", "TSR20", "disruption"),
    ("https://splash247.com/feed/", "TSR20", "disruption"),
    ("https://theloadstar.com/feed/", "TSR20", "disruption"),
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


def _google_site_fallback(feed_url: str, market: str, category: str, max_items: int) -> list[dict]:
    """Same publisher, read through Google News' index instead of the
    publisher's own feed. Cloudflare-fronted feeds (tyrepress, just-auto)
    serve residential IPs fine but reject datacenter egress — on Render they
    fail/return empty while Google, which is reachable there, has the same
    stories indexed within minutes. Google links are opaque redirects (so no
    bullets/images downstream), but a headline that lands beats a story that
    never arrives."""
    from app.news_scraper import fetch_google_news

    m = re.match(r"https?://(?:www\.)?([^/]+)", feed_url)
    if not m:
        return []
    items = fetch_google_news(f"site:{m.group(1)} when:2d", max_items=max_items)
    for item in items:
        item["market_tag"] = market
        item["category"] = category
    if items:
        logger.info("Feed %s recovered via Google site-index: %d items", feed_url, len(items))
    return items


def fetch_feed(url: str, market: str, category: str, max_items: int = 20) -> list[dict]:
    """Parse one publisher feed. Falls back to the Google News site-index for
    that domain on any failure or empty result — one dead feed must never
    stop the pass, and a blocked feed must still deliver its stories."""
    try:
        resp = _http.get(url, timeout=25)
        resp.raise_for_status()
        root = ElementTree.fromstring(resp.text)
    except Exception:
        logger.warning("RSS feed failed: %s — trying Google site-index", url)
        return _google_site_fallback(url, market, category, max_items)

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
    if not items:
        return _google_site_fallback(url, market, category, max_items)
    return items


# --- Google News link decoding -------------------------------------------
# A browser UA is required: Google serves the sig/ts-bearing page only to a
# real-looking client, not to the ResearchWire bot UA above.
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_GN_BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
# Datacenter IPs (Render) get Google's "Before you continue" consent
# interstitial instead of the sig/ts-bearing article page — a residential IP
# (a dev laptop) is already cookied and never sees it. Presenting an
# already-consented cookie skips the wall so the real page loads. This is the
# difference between decode working locally and failing in production.
_GN_CONSENT_COOKIE = "CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwMTA5LjA2X3AxGgJlbiACGgYIgLC_rgY"
_GN_SIG_RE = re.compile(r'data-n-a-sg="([^"]+)"')
_GN_TS_RE = re.compile(r'data-n-a-ts="([^"]+)"')
_GN_ID_RE = re.compile(r'data-n-a-id="([^"]+)"')


def decode_google_news_url(url: str) -> str | None:
    """Resolve a news.google.com/rss/articles/CBMi... redirect to the real
    publisher URL.

    Google News RSS hands back an opaque redirect, not the article's own URL,
    and a plain GET only lands back on a Google JS page. The target is
    recoverable through Google's own batchexecute endpoint: the article page
    carries a per-article signature + timestamp, and posting those back to
    DotsSplashUi returns the real URL. This is what lets the bullet pipeline
    reach the story behind a Google link — without it every Google-sourced
    item stays summary-less, which is most of a fresh deploy's wall. Returns
    None on any failure; the caller treats that as "leave the Google URL".

    (The module docstring's "0% of the time" note predates this — decoding
    now works from this host and from Render, both of which can reach Google.)
    """
    if "news.google." not in url or "/articles/" not in url:
        return None
    try:
        art = url.split("/articles/", 1)[1].split("?", 1)[0]
        headers = {"User-Agent": _BROWSER_UA, "Cookie": _GN_CONSENT_COOKIE}
        page = _http.get(
            f"https://news.google.com/rss/articles/{art}", headers=headers, timeout=25
        )
        sig = _GN_SIG_RE.search(page.text)
        ts = _GN_TS_RE.search(page.text)
        aid = _GN_ID_RE.search(page.text)
        if not (sig and ts and aid):
            return None
        inner = json.dumps(
            [
                "garturlreq",
                [
                    ["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1,
                     None, None, None, None, None, 0, 1],
                    "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0,
                ],
                aid.group(1), int(ts.group(1)), sig.group(1),
            ]
        )
        freq = json.dumps([[["Fbv4je", inner, None, "generic"]]])
        resp = _http.post(
            _GN_BATCH_URL,
            headers={**headers, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
            content="f.req=" + quote(freq),
            timeout=25,
        )
        body = resp.text[4:] if resp.text.startswith(")]}'") else resp.text
        outer = json.loads(body.strip().split("\n", 1)[0])
        for row in outer:
            if len(row) > 2 and row[1] == "Fbv4je" and row[2]:
                real = json.loads(row[2])[1]
                if isinstance(real, str) and real.startswith("http") and "news.google" not in real:
                    return real
    except Exception:
        logger.warning("Google News URL decode failed: %s", url[:80])
    return None


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


# Readability-lite fallback pieces: strip the non-content skeleton, prefer
# the <article> block when the publisher marks one, then keep substantial
# paragraphs. Runs only when Jina fails — Jina's extraction is better, this
# keeps the bullet pipeline alive through its rate limits and hiccups.
_SKELETON_RE = re.compile(r"<(script|style|nav|header|footer|aside|form|noscript)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_ARTICLE_RE = re.compile(r"<article[^>]*>(.*?)</article>", re.IGNORECASE | re.DOTALL)
_P_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.IGNORECASE | re.DOTALL)
_TAG_STRIP_RE = re.compile(r"<[^>]+>")
_PAYWALL_RE = re.compile(
    r"(subscribe to (read|continue)|sign in to (read|continue)|create a free account to"
    r"|this content is for (members|subscribers)|register to continue)",
    re.IGNORECASE,
)


def _extract_text_from_html(page_html: str) -> str | None:
    """Own-extraction fallback: the article's substantial paragraphs as plain
    text. Feeds the analyzer only — never displayed as a full article."""
    import html as html_module

    body = _SKELETON_RE.sub(" ", page_html)
    scope = _ARTICLE_RE.search(body)
    if scope:
        body = scope.group(1)
    paragraphs = []
    for m in _P_RE.finditer(body):
        text = html_module.unescape(_TAG_STRIP_RE.sub(" ", m.group(1)))
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 60:
            paragraphs.append(text)
    joined = "\n\n".join(paragraphs)
    if len(joined) < 300 or _PAYWALL_RE.search(joined[:600]):
        return None  # a stub or a paywall teaser would make garbage bullets
    return joined[:20000]


def fetch_full_text(url: str) -> str | None:
    """Whole article as markdown via Jina Reader, with an own-extraction
    fallback when Jina fails. This is what turns a headline into bullet
    points — the meta-description path only ever gave one sentence, and only
    when the publisher bothered to set the tag."""
    try:
        time.sleep(JINA_PACING_SECONDS)
        resp = _http.get(JINA_READER + url, timeout=JINA_TIMEOUT)
        if resp.status_code == 200:
            text = resp.text
            # Jina prefixes "Title:/URL Source:/Published Time:/Markdown
            # Content:"; the analyzer wants the body, not that envelope.
            marker = "Markdown Content:"
            if marker in text:
                text = text.split(marker, 1)[1]
            text = text.strip()
            if text:
                return text
    except Exception:
        pass

    page = fetch_article_page(url)
    return _extract_text_from_html(page) if page else None


def iter_rss_batches():
    """One batch per feed, so the caller can commit incrementally."""
    for url, market, category in FEEDS:
        yield f"rss {market} {url}", fetch_feed(url, market, category)
