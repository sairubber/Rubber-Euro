"""
Official TSR20 / natural-rubber trade statistics — UN Comtrade, zero cost.

Comtrade is the UN's official trade database: every figure here is a customs
declaration filed by a national government, not a scrape and not an estimate.
The public preview endpoint needs no API key and no signup.

HS code 4001 = "Natural rubber, balata, gutta-percha, guayule, chicle and
similar natural gums, in primary forms or in plates, sheets or strip" — the
commodity class TSR20 belongs to. TSR20 itself is a grade (technically
specified rubber, 20 impurity spec), not its own HS line; 4001 is the finest
official granularity that exists globally.

Reading the flows:
  exports (flowCode X) = SUPPLY  — what a producing country put on the market
  imports (flowCode M) = DEMAND  — what a consuming country pulled off it

Endpoint quirks learned by testing (both cost us a debugging round):
  - Multiple reporters in one request work: reporterCode=764,360,704
  - Multiple periods in one request do NOT — one request per period
  - Omitting partnerCode returns the bilateral partner breakdown; passing
    partnerCode=0 returns the world-total aggregate
"""

import logging
import time
from datetime import date

import httpx

logger = logging.getLogger("market_intel")

COMTRADE_URL = "https://comtradeapi.un.org/public/v1/preview/C/{freq}/HS"

# The four HS subheadings natural rubber actually trades under. Tracking
# these separately instead of the 4001 parent is what makes the numbers
# grade-accurate: TSR20 is technically specified rubber, which is its own
# line (400122) — reporting it inside an all-rubber aggregate mixed it with
# latex and sheet rubber that trade at different volumes and prices.
#
# Cup lumps caveat, stated plainly because the UI repeats it: field
# coagulum / cup lump has no dedicated HS line. It is upstream material that
# is mostly processed domestically into TSR rather than exported, so what
# 400129 captures is the modest share that does cross a border, filed as
# "other primary forms". It is the closest official proxy that exists, not
# an exact cup-lump production figure.
RUBBER_GRADES = {
    "400122": "TSR / TSNR (TSR20 grade)",
    "400121": "Ribbed Smoked Sheets (RSS)",
    "400110": "Latex",
    "400129": "Cup Lumps & Other Primary Forms",
}

_http = httpx.Client(
    headers={"User-Agent": "ResearchWire/1.0"},
    limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
)

# Comtrade's keyless preview tier rate-limits hard. At 1.5s pacing across a
# ~200-request pass it started returning 429s partway through, and because
# the grade loop is ordered, the *first* grade got complete data while later
# ones came back empty — latex and cup lumps ended up with zero annual rows
# while TSR looked fine. That failure is silent unless you check per-grade
# coverage, so pacing is now conservative and 429s are retried rather than
# swallowed as "no data".
REQUEST_PACING_SECONDS = 3.0
RETRY_BACKOFF_SECONDS = (15, 45, 90)

# M49 numeric codes. Producers are the supply side of the rubber market;
# consumers are the demand side. China and India appear in both — they are
# genuinely large producers AND the largest importers, and the site should
# show both faces rather than force them into one bucket.
PRODUCER_CODES = {
    764: "Thailand", 360: "Indonesia", 704: "Viet Nam", 458: "Malaysia",
    356: "India", 156: "China", 384: "Ivory Coast", 104: "Myanmar",
    116: "Cambodia", 418: "Laos", 608: "Philippines", 144: "Sri Lanka",
    430: "Liberia", 566: "Nigeria", 76: "Brazil", 288: "Ghana",
    120: "Cameroon", 598: "Papua New Guinea", 324: "Guinea",
}

CONSUMER_CODES = {
    156: "China", 842: "United States", 392: "Japan", 356: "India",
    276: "Germany", 410: "South Korea", 250: "France", 792: "Türkiye",
    724: "Spain", 380: "Italy", 76: "Brazil", 484: "Mexico",
    826: "United Kingdom", 616: "Poland", 203: "Czechia", 643: "Russia",
    528: "Netherlands", 124: "Canada", 764: "Thailand", 458: "Malaysia",
}

# Partner codes come back numeric with null names on the preview tier, so we
# carry our own lookup. Covers every producer/consumer above plus the transit
# and processing hubs that show up in bilateral rubber flows.
COUNTRY_NAMES = {
    **PRODUCER_CODES, **CONSUMER_CODES,
    0: "World", 36: "Australia", 40: "Austria", 56: "Belgium", 100: "Bulgaria",
    152: "Chile", 170: "Colombia", 191: "Croatia", 208: "Denmark", 218: "Ecuador",
    233: "Estonia", 246: "Finland", 300: "Greece", 344: "Hong Kong", 348: "Hungary",
    364: "Iran", 372: "Ireland", 376: "Israel", 400: "Jordan", 404: "Kenya",
    422: "Lebanon", 440: "Lithuania", 442: "Luxembourg", 504: "Morocco",
    554: "New Zealand", 578: "Norway", 586: "Pakistan", 604: "Peru",
    620: "Portugal", 642: "Romania", 682: "Saudi Arabia", 702: "Singapore",
    703: "Slovakia", 705: "Slovenia", 710: "South Africa", 752: "Sweden",
    757: "Switzerland", 158: "Taiwan", 784: "United Arab Emirates",
    804: "Ukraine", 818: "Egypt", 32: "Argentina", 50: "Bangladesh",
    112: "Belarus", 699: "India", 842: "United States", 251: "France",
    579: "Norway", 381: "Italy", 757: "Switzerland", 490: "Other Asia",
    97: "European Union", 837: "Free Zones", 899: "Areas NES",
}


def country_name(code: int) -> str:
    return COUNTRY_NAMES.get(code, f"Country {code}")


def _fetch(freq: str, period: str, flow: str, reporters: list[int], bilateral: bool, hs_code: str) -> list[dict]:
    """One Comtrade call. Returns [] on any failure — a missing period must
    never abort the whole refresh."""
    params = {
        "reporterCode": ",".join(str(c) for c in reporters),
        "period": period,
        "cmdCode": hs_code,
        "flowCode": flow,
        "partner2Code": 0,
        "customsCode": "C00",
        "motCode": 0,
    }
    if not bilateral:
        params["partnerCode"] = 0  # world aggregate only

    payload = None
    for attempt in range(len(RETRY_BACKOFF_SECONDS) + 1):
        try:
            time.sleep(REQUEST_PACING_SECONDS)
            resp = _http.get(COMTRADE_URL.format(freq=freq), params=params, timeout=30)
            if resp.status_code == 429:
                if attempt < len(RETRY_BACKOFF_SECONDS):
                    wait = RETRY_BACKOFF_SECONDS[attempt]
                    logger.info("Comtrade throttled (429) — backing off %ds [%s %s %s]", wait, hs_code, period, flow)
                    time.sleep(wait)
                    continue
                logger.warning("Comtrade still throttled after retries [%s %s %s] — skipping", hs_code, period, flow)
                return []
            resp.raise_for_status()
            payload = resp.json()
            break
        except Exception:
            if attempt < len(RETRY_BACKOFF_SECONDS):
                time.sleep(RETRY_BACKOFF_SECONDS[attempt])
                continue
            logger.warning("Comtrade fetch failed (freq=%s period=%s flow=%s hs=%s)", freq, period, flow, hs_code)
            return []
    if payload is None:
        return []

    rows = []
    for r in payload.get("data") or []:
        value = r.get("primaryValue")
        if not value:
            continue
        rows.append(
            {
                "reporter_code": r["reporterCode"],
                "reporter_name": country_name(r["reporterCode"]),
                "partner_code": r.get("partnerCode", 0),
                "partner_name": country_name(r.get("partnerCode", 0)),
                "flow": flow,  # X = export/supply, M = import/demand
                "freq": freq,  # A = annual, M = monthly
                "hs_code": hs_code,
                "grade": RUBBER_GRADES.get(hs_code, hs_code),
                "period": str(r["period"]),
                "value_usd": float(value),
                "qty_kg": float(r.get("netWgt") or 0.0),
                "is_estimated": bool(r.get("isNetWgtEstimated")),
            }
        )
    return rows


def recent_years(count: int = 6) -> list[str]:
    """Comtrade lags roughly a year on complete annual data, so start from
    last year rather than the current one."""
    end = date.today().year - 1
    return [str(y) for y in range(end - count + 1, end + 1)]


def recent_months(count: int = 12) -> list[str]:
    """YYYYMM strings, oldest first, ending ~3 months back — monthly filings
    take that long to land."""
    today = date.today()
    months = []
    y, m = today.year, today.month
    for _ in range(3):  # step back past the reporting lag
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    for _ in range(count):
        months.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(months))


def iter_trade_batches():
    """Yields (label, rows) batches so the caller can commit incrementally —
    same crash-resilience pattern as the news scraper. A full pass is ~60
    requests and takes a couple of minutes; losing it all to one bad period
    would be silly.

    Three passes:
      1. Annual world totals — the yearly report layer
      2. Monthly world totals — the monthly report layer + animated timeline
      3. Bilateral partner breakdown — who ships to whom
    """
    producers = list(PRODUCER_CODES)
    consumers = list(CONSUMER_CODES)
    grades = list(RUBBER_GRADES)

    # Annual first — it is the layer with the best reporter coverage, so the
    # site has trustworthy headline figures within the first minute even if
    # the longer monthly pass is still running.
    for year in recent_years():
        for hs in grades:
            yield f"annual supply {year} {hs}", _fetch("A", year, "X", producers, False, hs)
            yield f"annual demand {year} {hs}", _fetch("A", year, "M", consumers, False, hs)

    for month in recent_months():
        for hs in grades:
            yield f"monthly supply {month} {hs}", _fetch("M", month, "X", producers, False, hs)
            yield f"monthly demand {month} {hs}", _fetch("M", month, "M", consumers, False, hs)

    # Bilateral for the last three years, not just the newest — the newest
    # year is always thinly reported (Thailand, the largest exporter, had not
    # filed 2025 bilateral at all), so the analysis layer picks whichever of
    # these is best covered rather than being stuck with a sparse one.
    for year in recent_years(3):
        for hs in grades:
            yield f"bilateral {year} {hs}", _fetch("A", year, "X", producers, True, hs)
