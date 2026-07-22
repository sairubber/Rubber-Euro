"""
Per-article enrichment: a real summary pulled from the article's own page
(standard HTML meta tags — not fabricated, not AI-written), and a normalized
title used to catch duplicates that slip past URL-based dedup (the same
story indexed under two different URLs by Google News vs GDELT).
"""

import html as html_module
import logging
import re

import httpx

logger = logging.getLogger("market_intel")

# Pooled client shared by all meta-description fetches — these run in a small
# thread pool during each batch commit, and connection reuse matters there.
_http = httpx.Client(
    follow_redirects=True,
    headers={"User-Agent": "Mozilla/5.0 (compatible; ResearchWireBot/1.0)"},
    limits=httpx.Limits(max_connections=16, max_keepalive_connections=8),
)

_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")

_META_DESC_PATTERNS = [
    re.compile(r'<meta\s+[^>]*property=["\']og:description["\'][^>]*content=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<meta\s+[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:description["\']', re.IGNORECASE),
    re.compile(r'<meta\s+[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<meta\s+[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']description["\']', re.IGNORECASE),
    # Twitter cards — some outlets ship these but not og:description
    re.compile(r'<meta\s+[^>]*name=["\']twitter:description["\'][^>]*content=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<meta\s+[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']twitter:description["\']', re.IGNORECASE),
    # JSON-LD NewsArticle description — common on wire services
    re.compile(r'"description"\s*:\s*"((?:[^"\\]|\\.){40,400})"', re.IGNORECASE),
]

# Last resort: the article's own first substantial paragraph. Only used when
# every meta tag is missing, so most articles still get their publisher's own
# summary rather than a lead sentence.
_PARAGRAPH_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_COLLAPSE = re.compile(r"\s+")

# Boilerplate that shows up as the "first paragraph" on many news sites.
_BOILERPLATE = re.compile(
    r"(cookie|subscribe|sign in|newsletter|advertisement|javascript|enable js"
    r"|all rights reserved|privacy policy|terms of (use|service))",
    re.IGNORECASE,
)


# Article lead image. Publishers reliably set og:image for social cards, so
# this is the one image per article we can get without guessing at <img>
# tags (which are mostly logos, avatars and tracking pixels).
_IMAGE_PATTERNS = [
    re.compile(r'<meta\s+[^>]*property=["\']og:image(?::url)?["\'][^>]*content=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<meta\s+[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:image(?::url)?["\']', re.IGNORECASE),
    re.compile(r'<meta\s+[^>]*name=["\']twitter:image["\'][^>]*content=["\']([^"\']+)["\']', re.IGNORECASE),
]

# Sprites, tracking pixels and placeholder chrome dressed up as og:image.
_BAD_IMAGE = re.compile(
    r"(sprite|placeholder|default[-_]?(image|thumb)|logo|avatar|1x1|pixel|blank|spacer)",
    re.IGNORECASE,
)


def extract_image(html: str, base_url: str) -> str | None:
    """Absolute URL of the article's lead image, or None."""
    for pattern in _IMAGE_PATTERNS:
        match = pattern.search(html)
        if not match:
            continue
        url = html_module.unescape(match.group(1)).strip()
        if not url or _BAD_IMAGE.search(url):
            continue
        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/"):
            origin = re.match(r"(https?://[^/]+)", base_url)
            if not origin:
                continue
            url = origin.group(1) + url
        elif not url.startswith("http"):
            continue
        return url[:600]
    return None


def _first_paragraph(html: str) -> str | None:
    for match in _PARAGRAPH_RE.finditer(html):
        text = html_module.unescape(_TAG_RE.sub(" ", match.group(1)))
        text = _WS_COLLAPSE.sub(" ", text).strip()
        if len(text) < 80 or _BOILERPLATE.search(text):
            continue
        return text[:400]
    return None


def normalize_title(title: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace — for exact-ish
    duplicate detection across sources that word a headline identically but
    serve it from different URLs."""
    text = _PUNCT_RE.sub(" ", title.lower())
    return _WS_RE.sub(" ", text).strip()


def fetch_meta_description(url: str, timeout: float = 5.0) -> str | None:
    """Best-effort real summary from the article's own og:description or
    meta description tag. Returns None on any failure — a missing summary
    is fine, a hung pipeline is not."""
    try:
        resp = _http.get(url, timeout=timeout)
        if resp.status_code >= 400:
            return None
        # Meta tags live in <head>, but the paragraph fallback needs body
        # content, so scan further than the old 20k head-only window.
        html = resp.text[:80000]
    except Exception:
        return None

    for pattern in _META_DESC_PATTERNS:
        match = pattern.search(html)
        if match:
            desc = html_module.unescape(match.group(1)).replace("\\n", " ").strip()
            desc = _WS_COLLAPSE.sub(" ", desc)
            if len(desc) >= 40:
                return desc[:400]

    return _first_paragraph(html)
