"""
Auto-translation to English — zero AI cost. Language detection runs fully
locally (langdetect, no network call). Translation uses MyMemory's free
public API (no key required; an optional email param raises the daily quota,
see TRANSLATE_EMAIL in config). This is mechanical translation, not an LLM —
it does not summarize, analyze, or editorialize, just converts language.
"""

import logging
import re

import httpx
from langdetect import DetectorFactory, LangDetectException, detect_langs

from app.config import TRANSLATE_EMAIL

logger = logging.getLogger("market_intel")

MYMEMORY_URL = "https://api.mymemory.translated.net/get"
MAX_CHARS = 480  # MyMemory's free-tier per-request limit is ~500 bytes

# langdetect is otherwise non-deterministic on short/ambiguous text.
DetectorFactory.seed = 0

_LANGPAIR_FIXUP = {"zh-cn": "zh-CN", "zh-tw": "zh-TW"}

# Any of these ranges appearing means the text is unambiguously non-Latin —
# high-confidence signal to translate regardless of length.
_NON_LATIN_SCRIPT_RE = re.compile(
    r"[一-鿿぀-ヿ가-힯Ѐ-ӿ؀-ۿ฀-๿ऀ-ॿ]"
)


def detect_language(text: str) -> str | None:
    """Returns an ISO-ish language code, or None if detection isn't
    confident enough to act on. Deliberately conservative: langdetect is
    unreliable on short strings, and a false positive here means a correct
    English headline like "Singapore Exchange (SGX)" gets needlessly
    round-tripped through translation (and risks coming back mangled) — we
    hit exactly that in testing (short English titles misdetected as
    Tagalog/Romanian). Non-Latin script is an unambiguous signal and skips
    the extra scrutiny; pure Latin-script text needs to be longer and the
    detector needs to be confident before we act on it."""
    text = text.strip()
    if len(text) < 8:
        return None

    has_non_latin = bool(_NON_LATIN_SCRIPT_RE.search(text))
    if not has_non_latin and len(text) < 25:
        return None

    try:
        candidates = detect_langs(text)
    except LangDetectException:
        return None
    if not candidates:
        return None

    top = candidates[0]
    if top.lang == "en":
        return None
    if not has_non_latin and top.prob < 0.90:
        # Latin-script + low confidence — too likely to be a short English
        # phrase (place name, ticker, brand) that just confused the detector.
        return None

    return _LANGPAIR_FIXUP.get(top.lang, top.lang)


def translate_to_english(text: str, source_lang: str) -> str | None:
    """Best-effort machine translation. Returns None on any failure so the
    caller can fall back to the original text — never blocks the pipeline."""
    if not text.strip():
        return None
    params = {
        "q": text[:MAX_CHARS],
        "langpair": f"{source_lang}|en",
    }
    if TRANSLATE_EMAIL:
        params["de"] = TRANSLATE_EMAIL
    try:
        resp = httpx.get(MYMEMORY_URL, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        translated = data.get("responseData", {}).get("translatedText")
        # MyMemory returns quota/error messages as 200s with placeholder text.
        if not translated or "MYMEMORY WARNING" in translated.upper():
            return None
        return translated
    except Exception:
        logger.warning("Translation failed for language %r — keeping original text", source_lang)
        return None


def translate_article_if_needed(title: str, description: str) -> tuple[str, str, str | None]:
    """Detects the article's language from its title and, if it isn't
    English, translates both title and description. Returns
    (title, description, original_language) — original_language is None
    when no translation was needed or attempted."""
    lang = detect_language(title)
    if lang is None or lang == "en":
        return title, description, None

    translated_title = translate_to_english(title, lang)
    if translated_title is not None:
        # MyMemory sometimes returns fragments ("| in the province of …") for
        # titles it only partially matched. Strip leading junk and reject
        # anything too short to be a real headline.
        translated_title = translated_title.strip().lstrip("|·•:;,.-— ").strip()
        if len(translated_title) < 12:
            translated_title = None
    if translated_title is None:
        # Detection said non-English but translation failed — keep the
        # original rather than show a half-translated article.
        return title, description, None

    translated_description = translate_to_english(description, lang) if description else description
    if translated_description is None:
        translated_description = description

    return translated_title, translated_description, lang
