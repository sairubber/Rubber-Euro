"""Physical (spot) rubber prices from the Rubber Board of India.

The board's public page (rubberboard.gov.in/public) server-renders its daily
domestic price tables — Kottayam, Kochi and Agartala, per 100 kg, in both INR
and USD — so one plain GET and a straightforward parse yields the official
published numbers. No key, no API, and the figures are the board's own.

Physical quotes matter to a futures desk because the futures/physical spread
(the basis) is what physical traders actually buy and sell against.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.models import PhysicalPrice

logger = logging.getLogger("market_intel")

RB_URL = "https://rubberboard.gov.in/public"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
}

_TAB_RE = re.compile(r'<a[^>]*data-toggle="tab"[^>]*href="#(loc\d+)"[^>]*>(.*?)</a>', re.S)
_PANE_RE = re.compile(r'<div id="(loc\d+)"[^>]*>(.*?)</div>\s*(?=<div id="loc|<div class="tab-content|$)', re.S)
_ROW_RE = re.compile(r"<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>", re.S)
_DATE_RE = re.compile(r"on\s+(\d{1,2})-(\d{1,2})-(\d{4})")
_STRIP = re.compile(r"<[^>]+>|&#\d+;|&nbsp;")


def _clean(raw: str) -> str:
    return re.sub(r"\s+", " ", _STRIP.sub(" ", raw)).strip()


def _num(raw: str) -> float | None:
    m = re.search(r"[\d,]+(?:\.\d+)?", _clean(raw))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def fetch_rubberboard() -> list[dict]:
    """Parse the board's page into rows:
    {location, grade, inr, usd, price_date}. Rows the board marks '*'
    (no quotation that day) are skipped."""
    resp = httpx.get(RB_URL, headers=HEADERS, timeout=30, follow_redirects=True, verify=False)
    resp.raise_for_status()
    text = resp.text

    m = _DATE_RE.search(text)
    price_date = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else datetime.now(timezone.utc).date().isoformat()

    labels = {tab_id: _clean(label) for tab_id, label in _TAB_RE.findall(text)}
    rows: list[dict] = []
    for pane_id, body in _PANE_RE.findall(text):
        location = labels.get(pane_id, pane_id)
        for grade_raw, inr_raw, usd_raw in _ROW_RE.findall(body):
            grade = _clean(grade_raw)
            inr, usd = _num(inr_raw), _num(usd_raw)
            if not grade or grade.lower() == "category" or inr is None:
                continue
            rows.append({"location": location, "grade": grade, "inr": inr, "usd": usd, "price_date": price_date})
    return rows


def sync_physical_prices(db: Session) -> int:
    rows = fetch_rubberboard()
    written = 0
    for row in rows:
        existing = (
            db.query(PhysicalPrice)
            .filter(
                PhysicalPrice.location == row["location"],
                PhysicalPrice.grade == row["grade"],
                PhysicalPrice.price_date == row["price_date"],
            )
            .first()
        )
        if existing:
            existing.inr = row["inr"]
            existing.usd = row["usd"]
            existing.fetched_at = datetime.now(timezone.utc)
        else:
            db.add(PhysicalPrice(**row))
            written += 1
    db.commit()
    return written
