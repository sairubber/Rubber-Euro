"""
Key-points analyzer — turns a full article into 3-4 bullets, with no AI and
no cost.

This is extractive, not generative: every bullet is a sentence lifted
verbatim from the article. Nothing is paraphrased, summarised in our own
words, or inferred. That is a deliberate constraint — the whole site's
promise is "real news, scraped not synthesized", and a model-written summary
would quietly break it. The tradeoff is that bullets read like the source
(because they are the source) rather than like a tidy abstract.

Scoring favours the sentences a commodity desk would actually care about:
concrete numbers, prices, tonnage, percentage moves, named countries, and
market verbs. Boilerplate (cookie notices, author bios, disclaimers,
subscription prompts) is scored out.
"""

import re

# Sentence split that tolerates "U.S.", "No.", "Rs.", decimals like 1.5%
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")
_WS = re.compile(r"\s+")

# Markdown leftovers from Jina Reader output
# Images first, and greedily: Jina emits "![Image 11: caption](url)" but also
# bare "![Image 3: caption" with no closing paren when the source markup is
# ragged. A strict image pattern left "![Image 11: EUR/USD holds gains abov"
# glued onto the end of otherwise good bullets.
_MD_IMAGE = re.compile(r"!\[[^\]]*\](\([^)]*\))?|!\[[^\n]*")
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MD_NOISE = re.compile(r"[#*_>`]")
_URL = re.compile(r"https?://\S+")

_BOILERPLATE = re.compile(
    r"(cookie|subscribe|newsletter|sign in|log in|advertisement|all rights reserved"
    r"|privacy policy|terms of (use|service)|follow us|share this|read more"
    r"|click here|disclaimer|risk warning|past performance|is a technical analyst"
    r"|has more than \w+ years|contact us|©|\bcopyright\b)",
    re.IGNORECASE,
)

# Things that make a sentence worth quoting to a trader
_NUMBER = re.compile(r"\b\d[\d,.]*\b")
_PERCENT = re.compile(r"\d+(\.\d+)?\s?%")
_MONEY = re.compile(r"(\$|€|£|USD|EUR|INR|Rs\.?|¥)\s?\d|\bcents?\b|\bper (kg|tonne|ton|lb)\b", re.IGNORECASE)
_VOLUME = re.compile(r"\b(tonnes?|tons?|kilotonnes?|kt\b|million|billion|barrels?)\b", re.IGNORECASE)
_MARKET_VERB = re.compile(
    r"\b(rose|fell|gained|dropped|surged|slumped|climbed|declined|jumped|slipped"
    r"|increased|decreased|rallied|tumbled|eased|firmed|steadied|forecast|expects?"
    r"|projected|reported|announced|exports?|imports?|production|output|demand"
    r"|supply|shortage|surplus|price[sd]?|stockpiles?|inventor(y|ies))\b",
    re.IGNORECASE,
)
_COUNTRY = re.compile(
    r"\b(Thailand|Indonesia|Vietnam|Viet Nam|Malaysia|India|China|Ivory Coast"
    r"|C[oô]te d.Ivoire|Myanmar|Cambodia|Laos|Philippines|Sri Lanka|Liberia"
    r"|Nigeria|Brazil|Ghana|Cameroon|Japan|United States|US|EU|Europe|Germany"
    r"|France|Türkiye|Turkey|South Korea|Eurozone)\b"
)
_INSTITUTION = re.compile(
    r"\b(ECB|Fed(eral Reserve)?|FOMC|ANRPC|GAPKINDO|SGX|SICOM|IMF|World Bank"
    r"|Rubber Board|customs|central bank)\b",
    re.IGNORECASE,
)


def _tidy(sentence: str) -> str:
    text = _MD_IMAGE.sub(" ", sentence)
    text = _MD_LINK.sub(r"\1", text)
    # A sentence that still contains "](" is sitting on a markdown link the
    # splitter tore in half — the tail is another headline from a related-
    # links block, not part of this sentence. Cut there rather than print
    # "…amid a war?]( Wall Street Slides as Iran War Uncertainty…".
    if "](" in text:
        text = text.split("](", 1)[0]
    text = _URL.sub("", text)
    text = _MD_NOISE.sub("", text)
    return _WS.sub(" ", text).strip()


def _score(sentence: str, position: int, total: int) -> float:
    score = 0.0
    if _PERCENT.search(sentence):
        score += 3.0
    if _MONEY.search(sentence):
        score += 3.0
    if _VOLUME.search(sentence):
        score += 2.0
    if _MARKET_VERB.search(sentence):
        score += 2.0
    if _COUNTRY.search(sentence):
        score += 1.5
    if _INSTITUTION.search(sentence):
        score += 1.5
    score += min(len(_NUMBER.findall(sentence)), 4) * 0.5

    # Lead bias: news puts the point up front. Decays across the article.
    score += max(0.0, 2.5 * (1 - position / max(total, 1)))

    words = len(sentence.split())
    if words < 8:
        score -= 3.0  # fragment, caption, or stub heading
    elif words > 45:
        score -= 1.5  # rambling, poor as a bullet
    return score


def extract_key_points(full_text: str, max_points: int = 4) -> list[str]:
    """Top sentences from the article, kept in original reading order so the
    bullets still follow the story's logic rather than the score ranking."""
    if not full_text:
        return []

    candidates: list[tuple[int, str, float]] = []
    raw_sentences = _SENTENCE_SPLIT.split(full_text)
    total = len(raw_sentences)

    seen: set[str] = set()
    for i, raw in enumerate(raw_sentences):
        sentence = _tidy(raw)
        if not sentence or _BOILERPLATE.search(sentence):
            continue
        if not (12 <= len(sentence.split()) <= 60):
            continue
        # Drop near-duplicates (feeds repeat the lead in the body).
        fingerprint = sentence.lower()[:60]
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        candidates.append((i, sentence, _score(sentence, i, total)))

    if not candidates:
        return []

    top = sorted(candidates, key=lambda c: -c[2])[:max_points]
    # A bullet is only worth showing if it cleared the bar for *why* it was
    # picked — otherwise we'd print arbitrary prose and call it analysis.
    top = [c for c in top if c[2] >= 3.0]
    return [sentence for _, sentence, _ in sorted(top, key=lambda c: c[0])]


def build_summary(full_text: str, fallback: str = "") -> str:
    """One-paragraph summary: the highest-scoring lead sentence. Falls back
    to whatever description the feed gave us."""
    points = extract_key_points(full_text, max_points=1)
    return points[0] if points else fallback
