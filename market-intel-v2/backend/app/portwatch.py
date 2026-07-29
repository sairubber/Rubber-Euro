"""IMF PortWatch — satellite-AIS daily port activity, open data.

The IMF/Oxford PortWatch platform publishes daily port calls and cargo
import/export tonnage estimates per port, derived from satellite AIS
(services9.arcgis.com, Daily_Ports_Data FeatureServer — public, no key).
This is what fills the gap the free terrestrial AIS network leaves at the
rubber ports: not live positions, but real daily activity with a ~3-5 day
publication lag.

Import/export figures are PortWatch's model estimates of cargo tonnage (all
cargo, not rubber-specific) — labelled as such in the UI.
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta

import httpx

from app.netutil import get_retry

logger = logging.getLogger("market_intel")

QUERY_URL = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Ports_Data/FeatureServer/0/query"

# portid → display name, matched to the Vessel Watch boxes.
RUBBER_PORTS: dict[str, str] = {
    "port1197": "Laem Chabang",
    "port1211": "Songkhla",
    "port139": "Belawan (Medan)",
    "port1375": "Vung Tau",
    "port960": "Port Klang",
    "port1069": "Qingdao",
    "port583": "Cochin",
}

_cache: tuple[float, list[dict]] = (0.0, [])
_TTL = 6 * 3600  # the dataset gains one row per port per day


def get_port_activity(days: int = 60) -> list[dict]:
    """Per port: daily series + latest figures + 7-day average calls."""
    global _cache
    cached_at, cached = _cache
    if cached and time.time() - cached_at < _TTL:
        return cached

    since = (date.today() - timedelta(days=days + 7)).isoformat()
    ids = ",".join(f"'{p}'" for p in RUBBER_PORTS)
    try:
        resp = get_retry(
            QUERY_URL,
            params={
                "where": f"portid IN ({ids}) AND date >= DATE '{since}'",
                "outFields": "portid,date,portcalls,portcalls_cargo,import,export",
                "orderByFields": "portid,date",
                "resultRecordCount": 4000,
                "f": "json",
            },
            timeout=45,
        )
        features = resp.json().get("features") or []
    except Exception:
        logger.exception("PortWatch fetch failed — serving cached series")
        return cached

    by_port: dict[str, list[dict]] = {p: [] for p in RUBBER_PORTS}
    for f in features:
        a = f.get("attributes") or {}
        pid = a.get("portid")
        if pid not in by_port or not a.get("date"):
            continue
        by_port[pid].append(
            {
                "date": a["date"],
                "portcalls": a.get("portcalls") or 0,
                "portcalls_cargo": a.get("portcalls_cargo") or 0,
                "import_kt": round((a.get("import") or 0) / 1000, 1),
                "export_kt": round((a.get("export") or 0) / 1000, 1),
            }
        )

    out = []
    for pid, name in RUBBER_PORTS.items():
        series = by_port[pid]
        latest = series[-1] if series else None
        last7 = series[-7:]
        avg7 = round(sum(p["portcalls"] for p in last7) / len(last7), 1) if last7 else None
        out.append({"portid": pid, "port": name, "latest": latest, "avg7_calls": avg7, "series": series})

    if any(p["series"] for p in out):
        _cache = (time.time(), out)
    return out
