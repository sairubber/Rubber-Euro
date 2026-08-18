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
# Browser-like UA: the old "ResearchWireBot" string got 403'd by a fair share
# of publishers, which silently cost us their summaries and images. One
# transport-level retry absorbs the routine connection reset.
_http = httpx.Client(
    follow_redirects=True,
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "en",
    },
    limits=httpx.Limits(max_connections=16, max_keepalive_connections=8),
    transport=httpx.HTTPTransport(retries=1),
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
    # JSON-LD NewsArticle image — wire services often ship it when the
    # social-card tags are missing.
    re.compile(r'"image"\s*:\s*\[?\s*"(https?://[^"\\]{10,500})"', re.IGNORECASE),
    re.compile(r'"image"\s*:\s*\{[^}]*"url"\s*:\s*"(https?://[^"\\]{10,500})"', re.IGNORECASE),
]

# Last-resort content image: an <img> inside the article body with a real
# size hint. Anything without width/height attributes is skipped — that's
# where the logos, avatars and pixels live.
_CONTENT_IMG_RE = re.compile(
    r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>',
    re.IGNORECASE,
)
_IMG_SIZE_RE = re.compile(r'(?:width|height)=["\']?(\d{3,4})', re.IGNORECASE)

# Sprites, tracking pixels and placeholder chrome dressed up as og:image.
_BAD_IMAGE = re.compile(
    r"(sprite|placeholder|default[-_]?(image|thumb)|logo|avatar|1x1|pixel|blank|spacer)",
    re.IGNORECASE,
)


def _absolutize(url: str, base_url: str) -> str | None:
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        origin = re.match(r"(https?://[^/]+)", base_url)
        return origin.group(1) + url if origin else None
    return url if url.startswith("http") else None


def extract_image(html: str, base_url: str) -> str | None:
    """Absolute URL of the article's lead image, or None. Tries the social
    card tags first, then JSON-LD, then — new — a sized content <img> from
    the body, so articles from publishers without card tags still get their
    real photo instead of a blank slot."""
    for pattern in _IMAGE_PATTERNS:
        match = pattern.search(html)
        if not match:
            continue
        url = html_module.unescape(match.group(1)).strip()
        if not url or _BAD_IMAGE.search(url):
            continue
        absolute = _absolutize(url, base_url)
        if absolute:
            return absolute[:600]

    # Content-image fallback: only <img> tags carrying a >=300px width or
    # height attribute qualify — small/unsized images are chrome, not photos.
    for match in _CONTENT_IMG_RE.finditer(html):
        tag = match.group(0)
        sizes = [int(s) for s in _IMG_SIZE_RE.findall(tag)]
        if not sizes or max(sizes) < 300:
            continue
        url = html_module.unescape(match.group(1)).strip()
        if not url or _BAD_IMAGE.search(url) or url.startswith("data:"):
            continue
        absolute = _absolutize(url, base_url)
        if absolute:
            return absolute[:600]
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
