"""
Real news, zero API cost. Google News RSS and GDELT both need no key/signup
at all and return genuine articles from real outlets — these just aggregate
and redirect. NewsAPI.org is layered in as an optional free-tier supplement
in news.py.
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

GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search"
GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

# One pooled client for the whole scrape pass — reusing keep-alive
# connections to news.google.com / gdeltproject.org instead of a fresh TLS
# handshake per query cuts a meaningful slice off every pass.
_http = httpx.Client(
    headers={"User-Agent": "Mozilla/5.0"},
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)

# Every country the original spec tracks as a natural-rubber producer:
# ANRPC's 13 members + the non-member producers. Matched against article
# title+description so news can be tagged by country even where we don't
# have an Open-Meteo climate reading (climate.PRODUCING_REGIONS only covers
# the 7 we have exact tap coordinates for — this list is broader, it's what
# "all the countries who produce natural rubber" actually means for news).
PRODUCING_COUNTRIES = [
    "Thailand", "Indonesia", "Vietnam", "India", "Myanmar", "Malaysia", "Cambodia",
    "Sri Lanka", "Philippines", "Bangladesh", "Papua New Guinea", "Singapore", "China",
    "Ivory Coast", "Liberia", "Nigeria", "Ghana", "Guinea", "Cameroon", "Brazil", "Peru",
]

# GDELT does fuzzy full-text matching and happily returns e.g. a jackfruit
# trade story for a "Cambodia rubber export" query. Google News queries are
# precise, so this gate applies to GDELT results only: the article must
# actually mention the market's subject somewhere in its title.
MARKET_RELEVANCE = {
    # Beyond the commodity itself, the demand side counts: car/truck
    # PRODUCTION and SALES stories are NR-demand records even when the word
    # "tire" never appears (~70% of NR goes into tires). The MARKET_SIGNAL
    # gate below still requires a production/sales/price word, so model
    # reviews and launch coverage stay out.
    "TSR20": re.compile(
        r"\b(rubber|tyre|tire|latex|tsr\s?20|sicom|plantation"
        r"|(car|auto|vehicle|truck|ev) (production|output|sales)"
        r"|automaker|carmaker|auto industry)\b",
        re.IGNORECASE,
    ),
    "EURUSD": re.compile(
        r"\b(euro(zone)?|dollar|eur\s?/?\s?usd|ecb|fed|federal reserve|forex|exchange rate"
        r"|inflation|interest rate|monetary|dxy|fomc|currenc(y|ies)|central bank)\b",
        re.IGNORECASE,
    ),
}

# Broad publisher feeds (tyre trade press, commodity wires) carry a lot of
# industry PR — factory openings, executive appointments, sponsorship deals,
# ESG index inclusions — that mentions "rubber" or "tyre" without saying
# anything about the market. The subject gate above lets those through, so
# feed items must ALSO show a market signal: a price, a volume, a flow, or a
# supply/demand word.
MARKET_SIGNAL = re.compile(
    r"\b(price[sd]?|pricing|cost[s]?|export[s]?|import[s]?|production|output"
    r"|supply|demand|shortage|surplus|stockpile[s]?|inventor(y|ies)|tonnes?|tons?"
    r"|futures?|forecast|harvest|yield|tapping|shipment[s]?|cargo|trade"
    r"|rate cut|rate hike|inflation|interest rate|exchange rate|currency)\b",
    re.IGNORECASE,
)

# Synthetic rubber is a different commodity with different economics. LSR
# (liquid silicone rubber), SBR and butyl stories were arriving on the TSR20
# wall purely because the word "rubber" appears in them.
SYNTHETIC_RUBBER = re.compile(
    r"\b(liquid silicone|LSR|silicone rubber|SBR|styrene[- ]butadiene"
    r"|halo?butyl|butyl rubber|synthetic rubber|EPDM|nitrile|polybutadiene"
    r"|neoprene|chloroprene)\b",
    re.IGNORECASE,
)


# EURUSD's subject gate above accepts generic macro words ("inflation",
# "central bank", "currency") because Google News queries are already
# targeted. A general forex feed is not: FXStreet publishes every pair, so
# AUD/NZD/CAD/GBP stories sailed onto the EUR/USD wall. Feed items must name
# the euro, the US dollar, or the two central banks that move the pair.
EURUSD_CORE = re.compile(
    r"\b(euro(zone|pean)?|eur[\s/]?usd|ecb|european central bank"
    r"|us dollar|u\.s\. dollar|greenback|dxy|dollar index"
    r"|fed(eral reserve)?|fomc)\b",
    re.IGNORECASE,
)

# A headline about another pair is not EUR/USD news, even when it mentions
# the dollar on the other side of that pair.
OTHER_FX_PAIRS = re.compile(
    r"\b(aud|nzd|cad|chf|jpy|gbp|cny|inr|mxn|zar|brl"
    r"|australian dollar|new zealand dollar|canadian dollar|kiwi|aussie|loonie"
    r"|swiss franc|japanese yen|british pound|sterling|pound)\b",
    re.IGNORECASE,
)


def is_market_news(title: str, description: str, market: str) -> bool:
    """Stricter gate for publisher feeds: the item must be about the market,
    not merely mention the commodity."""
    text = f"{title} {description}"
    if market == "TSR20":
        if SYNTHETIC_RUBBER.search(text):
            return False
    elif market == "EURUSD":
        # Judge on the headline: a EUR/USD article can mention the yen in
        # passing, but a yen article that mentions the euro in passing is not
        # EUR/USD news. If another pair is named in the title, the euro has
        # to be named there too.
        if not EURUSD_CORE.search(title):
            return False
        if OTHER_FX_PAIRS.search(title) and not re.search(
            r"\b(euro(zone)?|eur[\s/]?usd|ecb)\b", title, re.IGNORECASE
        ):
            return False

    subject = MARKET_RELEVANCE.get(market)
    if subject and not subject.search(text):
        return False
    return bool(MARKET_SIGNAL.search(text))


# Niche query sets — each tuple is (query, category). category drives which
# feed a story shows up in on the frontend (headline / trade / disruption).
# Deliberately broad: the more queries, the more of the real web gets covered.
NICHE_QUERIES: dict[str, list[tuple[str, str]]] = {
    "TSR20": [
        ("TSR20 rubber OR SICOM rubber futures", "headline"),
        ("natural rubber price Thailand Indonesia Vietnam", "headline"),
        ("SGX rubber futures price", "headline"),
        ("tyre industry rubber raw material prices", "headline"),
        ("rubber futures market outlook Asia", "headline"),
        ("China tyre manufacturer rubber demand", "headline"),
        ("ANRPC rubber bulletin OR GAPKINDO rubber export", "trade"),
        ("Rubber Board India export OR Thailand rubber export data", "trade"),
        ("Vietnam rubber export customs data", "trade"),
        ("Ivory Coast rubber export OR APROMAC rubber", "trade"),
        ("China rubber import customs GACC", "trade"),
        ("Myanmar rubber export OR Cambodia rubber export", "trade"),
        ("Sri Lanka rubber production OR Philippines rubber production", "trade"),
        ("Bangladesh rubber OR Papua New Guinea rubber export", "trade"),
        ("Liberia rubber export OR Nigeria rubber production", "trade"),
        ("Ghana rubber plantation OR Cameroon rubber export", "trade"),
        ("Brazil natural rubber production OR Peru rubber production", "trade"),
        ("rubber plantation disease OR rubber leaf fall Thailand", "disruption"),
        ("rubber tapping disruption OR rubber plantation flooding", "disruption"),
        ("Thailand flood rubber OR Vietnam typhoon rubber", "disruption"),
        ("rubber tree disease outbreak Southeast Asia", "disruption"),
        ("Malaysia SMR rubber price OR Malaysian Rubber Board", "headline"),
        ("Indonesia SIR20 rubber export", "trade"),
        ("Japan OSE rubber futures RSS3", "headline"),
        ("EUDR rubber deforestation regulation", "trade"),
        ("Michelin OR Bridgestone OR Goodyear natural rubber", "headline"),
        ("rubber glove latex demand industry", "headline"),
        # Demand side — car/tire manufacturing is ~70% of NR consumption.
        ("China tire factory operating rate OR Shandong tyre plant", "trade"),
        ("tire plant expansion OR new tyre factory investment", "trade"),
        ("heavy truck sales China OR commercial vehicle sales tires", "headline"),
        ("China auto production CAAM vehicle output", "headline"),
        ("India tyre demand MRF OR Apollo Tyres OR CEAT rubber", "headline"),
        ("EV electric vehicle tire demand rubber", "headline"),
        ("tyre maker rubber procurement raw material cost", "trade"),
        ("US tire imports tariff OR tyre import duty", "trade"),
        ("Europe car production output tyre demand", "headline"),
        ("Japan carmaker production output Toyota tires", "headline"),
        ("Pirelli OR Continental OR Hankook OR Sumitomo natural rubber", "headline"),
        ("tyre replacement aftermarket demand", "headline"),
        # Climate → supply: the direct weather/production channel.
        ("climate change rubber production drought", "disruption"),
        ("El Nino OR La Nina rubber Southeast Asia", "disruption"),
        ("monsoon rain rubber tapping Kerala OR Thailand", "disruption"),
        ("heatwave OR drought rubber plantation yield", "disruption"),
        # War / logistics: conflict and freight shocks hit rubber shipping.
        ("Red Sea shipping attack cargo Asia", "disruption"),
        ("war conflict supply chain rubber Asia", "disruption"),
        ("Strait of Malacca OR Suez shipping disruption", "disruption"),
        ("container freight rates Asia Europe surge", "trade"),
        ("port strike OR port congestion Southeast Asia", "disruption"),
    ],
    "EURUSD": [
        ("EUR/USD forex forecast", "headline"),
        ("euro dollar exchange rate today", "headline"),
        ("ECB interest rate euro", "headline"),
        ("Federal Reserve euro dollar policy", "headline"),
        ("dollar index DXY forecast", "headline"),
        ("eurozone inflation economy forex", "trade"),
        ("US dollar index eurozone trade", "trade"),
        ("ECB monetary policy statement", "trade"),
        ("Fed FOMC minutes rate decision", "trade"),
        ("eurozone recession risk OR eurozone growth data", "disruption"),
        ("US inflation CPI surprise dollar", "disruption"),
        ("euro area PMI manufacturing services data", "headline"),
        ("US nonfarm payrolls jobs report dollar", "headline"),
        ("US treasury yields euro dollar bond market", "headline"),
        ("EUR/USD technical analysis support resistance", "headline"),
        ("German economy Bundesbank euro", "headline"),
        # War / geopolitics: the risk channel that moves EUR/USD hardest.
        ("Middle East war oil price euro dollar", "disruption"),
        ("Russia Ukraine war euro economy energy", "disruption"),
        ("Iran Strait of Hormuz oil dollar", "disruption"),
        ("geopolitical risk safe haven dollar euro", "headline"),
        ("NATO Europe defence spending euro", "headline"),
    ],
}


def _detect_country(text: str) -> str | None:
    lowered = text.lower()
    for country in PRODUCING_COUNTRIES:
        if country.lower() in lowered:
            return country
    return None


def _strip_html(raw: str) -> str:
    text = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _clean_title(title: str, source_name: str) -> str:
    if source_name and title.endswith(f" - {source_name}"):
        return title[: -(len(source_name) + 3)].strip()
    return title


def _parse_pubdate(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(timezone.utc)
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def fetch_google_news(query: str, max_items: int = 12) -> list[dict]:
    """Fetch and parse a Google News RSS search feed. Real articles, no API key."""
    params = {"q": query, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"}
    try:
        resp = _http.get(GOOGLE_NEWS_RSS_URL, params=params, timeout=15)
        resp.raise_for_status()
        root = ElementTree.fromstring(resp.text)
    except Exception:
        logger.exception("Google News RSS fetch failed for query %r", query)
        return []

    items = []
    for item in root.findall(".//item")[:max_items]:
        raw_title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not raw_title or not link:
            continue
        source_el = item.find("source")
        source_name = (source_el.text or "").strip() if source_el is not None else ""
        description = _strip_html(item.findtext("description") or "")
        clean_title = _clean_title(raw_title, source_name)
        # Google's own RSS snippet is just "{title} {source}" — drop it rather than show a near-duplicate.
        if description.lower() in (clean_title.lower(), f"{clean_title} {source_name}".lower().strip()):
            description = ""
        published_at = _parse_pubdate(item.findtext("pubDate"))

        items.append(
            {
                "title": clean_title,
                "description": description,
                "url": link,
                "source_name": source_name,
                "country": _detect_country(f"{clean_title} {description}"),
                "published_at": published_at,
            }
        )
    return items


def fetch_gdelt(query: str, max_items: int = 12) -> list[dict]:
    """Fetch from GDELT's free Doc 2.0 API — a second independent real-news
    source, broader global coverage, no key required."""
    params = {
        "query": query,
        "mode": "artlist",
        "maxrecords": max_items,
        "sort": "datedesc",
        "format": "json",
    }
    try:
        resp = _http.get(GDELT_DOC_URL, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.exception("GDELT fetch failed for query %r", query)
        return []

    items = []
    for a in data.get("articles", []):
        title = (a.get("title") or "").strip()
        url = (a.get("url") or "").strip()
        if not title or not url:
            continue
        try:
            published_at = datetime.strptime(a["seendate"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            published_at = datetime.now(timezone.utc)

        items.append(
            {
                "title": title,
                "description": "",
                "url": url,
                "source_name": (a.get("domain") or "").strip(),
                "country": _detect_country(title),
                "published_at": published_at,
            }
        )
    return items


def iter_niche_query_batches(include_gdelt: bool = True):
    """Run every configured niche query, against both sources, for every market
    — yielding one batch (list[dict]) per query so the caller can commit
    incrementally. A full pass touches ~50 external requests; yielding as we
    go means a mid-pass crash or restart only loses the current batch, not
    everything gathered so far, and articles show up on the site as soon as
    each query resolves instead of only after the whole pass finishes.

    GDELT's free endpoint rate-limits rapid sequential requests (429s) — a
    pause between calls means we mostly get real data back instead of 429s.
    Google News RSS has been reliable without one.

    Markets are interleaved round-robin (TSR20, EURUSD, TSR20, …) rather than
    run back-to-back: TSR20 has ~2x the queries, and running it to completion
    first meant EUR/USD only got fresh articles at the tail of every pass —
    on a slow pass the EUR/USD wall looked stale or empty while TSR20 was
    already full. Interleaving gives both walls fresh data within the first
    minute of every pass."""
    tagged: dict[str, list[tuple[str, str, str]]] = {
        market: [(market, query, category) for query, category in queries]
        for market, queries in NICHE_QUERIES.items()
    }
    interleaved: list[tuple[str, str, str]] = []
    market_lists = list(tagged.values())
    for i in range(max(len(lst) for lst in market_lists)):
        for lst in market_lists:
            if i < len(lst):
                interleaved.append(lst[i])

    for market, query, category in interleaved:
        relevance = MARKET_RELEVANCE.get(market)
        batch = []

        # GDELT goes FIRST, deliberately. Both sources carry many of the same
        # stories, and title-dedup keeps whichever lands first — so ordering
        # decides which URL we store. GDELT gives the real publisher URL;
        # Google News gives an opaque news.google.com/rss/articles/CBMi...
        # redirect whose target Google encodes and will not resolve for a
        # bot (its own RSS <description> is just "title - source", and the
        # batchexecute resolver is blocked). Measured consequence: articles
        # stored with a publisher URL got a real summary 88% of the time,
        # Google-redirect articles 0%. Preferring GDELT is what makes
        # summaries possible at all.
        # include_gdelt=False is the fast lane: GDELT answers in ~10s per
        # query (it throttles free callers), which is what turned a fresh
        # database's first fill into an hour-plus. Google alone answers in
        # under a second per query.
        if include_gdelt:
            for article in fetch_gdelt(query):
                if relevance and not relevance.search(article["title"]):
                    continue
                article["market_tag"] = market
                article["category"] = category
                batch.append(article)

            time.sleep(2.0)
        # Google News still runs — its coverage is broader, and it is the
        # only source for plenty of regional trade stories. It just no
        # longer displaces a GDELT copy of the same headline.
        for article in fetch_google_news(query):
            if relevance and not relevance.search(f"{article['title']} {article['description']}"):
                continue
            article["market_tag"] = market
            article["category"] = category
            batch.append(article)

        yield batch


def scrape_all_niche_queries() -> list[dict]:
    """Convenience wrapper for callers that just want everything at once
    (e.g. a one-off manual refresh) rather than incremental commits."""
    results: list[dict] = []
    for batch in iter_niche_query_batches():
        results.extend(batch)
    return results
