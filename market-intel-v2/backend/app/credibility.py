"""
Rule-based source credibility — the "is this genuine news?" layer, zero AI.

Three visible tiers plus a hard blocklist:
  - "verified": global wires, major financial press, official bodies and
    exchanges. Named, accountable newsrooms.
  - "trusted":  established regional/trade press that consistently covers
    rubber or FX with real reporting.
  - "unrated":  everything else the aggregators surface. Still real articles
    from real sites — just not outlets we can vouch for by name.
Blocked outright (never stored): press-release wires and market-research
report sellers whose "articles" are product pages or paid placements, not
journalism. That is the main spam that slips through news aggregators.

Matching is by source name/domain substring, case-insensitive, so both
Google News source names ("FXStreet") and GDELT domains ("fxstreet.com")
hit the same entry.
"""

import re

VERIFIED_SOURCES = [
    # Global wires + major financial press
    "reuters", "bloomberg", "financial times", "ft.com", "wall street journal",
    "wsj.com", "cnbc", "nikkei", "economist", "marketwatch", "barron",
    "yahoo finance", "finance.yahoo", "morningstar", "investing.com", "fxstreet",
    "dailyfx", "forexlive", "tradingeconomics", "s&p global", "spglobal",
    # Major Indian financial press (site audience is India-based)
    "economic times", "economictimes", "business standard", "business-standard",
    "livemint", "mint", "moneycontrol", "hindu businessline", "thehindubusinessline",
    # Official bodies, exchanges, industry associations
    "anrpc", "rubber board", "sgx", "singapore exchange", "ecb", "european central bank",
    "federal reserve", "bank of", "ministry of", "customs",
]

TRUSTED_SOURCES = [
    # Established regional press in producing countries
    "bangkok post", "the nation thailand", "jakarta post", "jakarta globe", "antara",
    "vnexpress", "vietnam news", "vietnamplus", "viet nam news", "the star", "new straits times",
    "businesstoday", "malay mail", "the edge", "manila times", "philstar", "daily mirror",
    "chosun", "korea herald", "maeil", "yonhap",
    # Rubber / commodity / tyre trade press
    "tyrepress", "tire business", "rubber journal", "rubberworld", "rubber news",
    "chemanalyst", "sunsirs", "krungsri", "smartkarma", "theinvestor", "hellenic shipping",
    "argus media", "fastmarkets", "commodity",
    # FX / macro trade press
    "actionforex", "fxempire", "poundsterlinglive", "exchangerates.org",
    "capital economics", "ing think", "danske", "mufg", "litefinance",
]

# Never stored. Press-release distribution + report-seller domains — their
# "headlines" are ads shaped like news.
BLOCKED_SOURCES = [
    "openpr", "einpresswire", "ein presswire", "prnewswire", "pr newswire",
    "businesswire", "globenewswire", "prunderground", "issuewire", "abnewswire",
    "indexbox", "marketresearchintellect", "verifiedmarketresearch",
    "databridgemarketresearch", "imarcgroup", "grandviewresearch",
    "researchandmarkets", "mordorintelligence", "futuremarketinsights",
    "marketsandmarkets", "technavio", "openpr.com",
]

# Title shapes that are report-seller product pages regardless of domain.
_SPAM_TITLE_RE = re.compile(
    r"(market report \d{4}|market size,? share|size, share,? (and|&) (growth|forecast)"
    r"|forecast,? and companies|industry report \d{4}|swot analysis)",
    re.IGNORECASE,
)


def _matches(source: str, entries: list[str]) -> bool:
    return any(entry in source for entry in entries)


def credibility_for(source_name: str) -> str:
    source = (source_name or "").lower().strip()
    if not source:
        return "unrated"
    if _matches(source, VERIFIED_SOURCES):
        return "verified"
    if _matches(source, TRUSTED_SOURCES):
        return "trusted"
    return "unrated"


def is_spam(source_name: str, title: str) -> bool:
    """True for articles that should never be stored: press-release wires,
    report sellers, and report-shaped titles."""
    source = (source_name or "").lower().strip()
    if _matches(source, BLOCKED_SOURCES):
        return True
    if _SPAM_TITLE_RE.search(title or ""):
        return True
    return False
