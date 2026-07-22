"""
Eurostat COMEXT — the second official trade source, and the fresh one.

Why this exists alongside UN Comtrade: Comtrade aggregates filings from every
country on earth, but it inherits their reporting lag. In practice its newest
*complete* year runs one to two years behind — the site was showing 2023 as
the latest rankable year while the calendar read 2026. Eurostat publishes the
EU's own customs declarations monthly, roughly five months behind real time,
and covers exactly the trade lane that matters most for demand: rubber
arriving in Europe from every producing country.

So the two sources answer different questions and the UI keeps them apart:
  Comtrade  — global picture, every reporter, deep history, slow
  Eurostat  — EU only, but monthly and current

Dataset `ds-045409` ("EU trade since 1988 by HS2-4-6 and CN8") is free and
needs no key. Note the base path: the plain
/eurostat/api/dissemination/... host returns 404 for this dataset — COMEXT
lives under /eurostat/api/comext/dissemination/... instead.
"""

import logging
import time
from datetime import date

import httpx

from app.trade_data import RUBBER_GRADES

logger = logging.getLogger("market_intel")

EUROSTAT_URL = (
    "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/ds-045409"
)

REQUEST_PACING_SECONDS = 1.0

_http = httpx.Client(
    headers={"User-Agent": "ResearchWire/1.0"},
    limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
)

# ISO-2 partner codes for the producing countries, mapped to the same display
# names the Comtrade side uses so both sources agree on spelling (this is why
# "Ivory Coast" appears rather than "Côte d'Ivoire" — one name site-wide).
# ISO-2 -> (M49 numeric, display name). The numeric code is deliberately the
# same M49 code Comtrade uses for that country: rows are keyed on
# (reporter, partner, flow, freq, period, hs_code), so Eurostat needs a
# distinct partner code per country or every producing country collides on
# one key and only the first insert survives (this bit us — the whole first
# pull failed on a UNIQUE constraint). Reusing M49 also means a join across
# the two sources lines up on country without a translation table.
PRODUCER_PARTNERS = {
    "TH": (764, "Thailand"), "ID": (360, "Indonesia"), "VN": (704, "Viet Nam"),
    "MY": (458, "Malaysia"), "IN": (356, "India"), "CN": (156, "China"),
    "CI": (384, "Ivory Coast"), "MM": (104, "Myanmar"), "KH": (116, "Cambodia"),
    "LA": (418, "Laos"), "PH": (608, "Philippines"), "LK": (144, "Sri Lanka"),
    "LR": (430, "Liberia"), "NG": (566, "Nigeria"), "BR": (76, "Brazil"),
    "GH": (288, "Ghana"), "CM": (120, "Cameroon"), "GN": (324, "Guinea"),
}

# flow 1 = import (into the EU = EU demand), 2 = export (out of the EU)
FLOW_IMPORT = "1"
FLOW_EXPORT = "2"


def recent_months(count: int = 18) -> list[str]:
    """YYYY-MM strings, oldest first. Eurostat runs ~4-5 months behind, so
    start back far enough that the newest requested month usually exists."""
    today = date.today()
    y, m = today.year, today.month
    for _ in range(4):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months = []
    for _ in range(count):
        months.append(f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(months))


def _parse(payload: dict, hs_code: str, flow: str, period: str) -> list[dict]:
    """JSON-stat decode. Values are keyed by a single flattened index across
    all dimensions, so the partner and indicator have to be recovered from
    the declared dimension sizes rather than read off the row."""
    dims = payload.get("dimension", {})
    ids = payload.get("id", [])
    sizes = payload.get("size", [])
    values = payload.get("value", {})
    if not values or "partner" not in ids or "indicators" not in ids:
        return []

    partner_index = {i: code for code, i in dims["partner"]["category"]["index"].items()}
    indicator_index = {i: code for code, i in dims["indicators"]["category"]["index"].items()}
    n_partner = sizes[ids.index("partner")]
    n_indicator = sizes[ids.index("indicators")]

    by_partner: dict[str, dict] = {}
    for key, val in values.items():
        flat = int(key)
        indicator = indicator_index.get(flat % n_indicator)
        partner = partner_index.get((flat // n_indicator) % n_partner)
        if partner is None or indicator is None:
            continue
        entry = by_partner.setdefault(partner, {})
        entry[indicator] = float(val)

    rows = []
    for partner_code, metrics in by_partner.items():
        value_eur = metrics.get("VALUE_IN_EUROS")
        if not value_eur:
            continue
        # Eurostat reports quantity in 100kg units; the rest of the app
        # stores kilograms, so convert rather than mix units in one column.
        qty_kg = metrics.get("QUANTITY_IN_100KG", 0.0) * 100
        code, name = PRODUCER_PARTNERS.get(partner_code, (0, partner_code))
        rows.append(
            {
                "reporter_code": 97,  # M49-style stand-in for the EU bloc
                "reporter_name": "European Union",
                "partner_code": code,
                "partner_name": name,
                "flow": "M" if flow == FLOW_IMPORT else "X",
                "freq": "M",
                "hs_code": hs_code,
                "grade": RUBBER_GRADES.get(hs_code, hs_code),
                "period": period.replace("-", ""),  # YYYYMM, matching Comtrade
                "value_usd": value_eur,  # EUR — see `currency`; never summed with Comtrade USD
                "currency": "EUR",
                "qty_kg": qty_kg,
                "is_estimated": False,
                "source": "eurostat",
            }
        )
    return rows


def _fetch(hs_code: str, flow: str, period: str) -> list[dict]:
    params = [
        ("format", "JSON"),
        ("freq", "M"),
        ("reporter", "EU27_2020"),
        ("product", hs_code),
        ("flow", flow),
        ("indicators", "VALUE_IN_EUROS"),
        ("indicators", "QUANTITY_IN_100KG"),
        ("time", period),
    ]
    params += [("partner", code) for code in PRODUCER_PARTNERS]

    try:
        time.sleep(REQUEST_PACING_SECONDS)
        resp = _http.get(EUROSTAT_URL, params=params, timeout=40)
        resp.raise_for_status()
        payload = resp.json()
    except Exception:
        logger.warning("Eurostat fetch failed (hs=%s flow=%s period=%s)", hs_code, flow, period)
        return []

    return _parse(payload, hs_code, flow, period)


def iter_eurostat_batches():
    """One batch per (grade, flow, month). Every producing country rides in
    the same request, so a full pass is 4 grades x 2 flows x 18 months = 144
    calls, paced at 1s."""
    for hs_code in RUBBER_GRADES:
        for flow in (FLOW_IMPORT, FLOW_EXPORT):
            for period in recent_months():
                label = f"eurostat {hs_code} {'import' if flow == FLOW_IMPORT else 'export'} {period}"
                yield label, _fetch(hs_code, flow, period)
