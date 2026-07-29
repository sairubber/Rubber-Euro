"""Live AIS vessel watch over the rubber trade's key port anchorages.

Source: aisstream.io free websocket feed (user-registered key, AISSTREAM_KEY
in the environment). We subscribe to bounding boxes drawn around the ports
that matter to TSR20 — origin (Laem Chabang/Bangkok, Songkhla, Belawan,
Ho Chi Minh/Vung Tau, Port Klang) and discharge (Qingdao, Cochin) — and keep
the latest position per vessel in memory.

Honesty note carried through to the UI: AIS shows SHIPS, not cargoes. A
vessel inside the Laem Chabang box is not proof of rubber on board — the
manifest data that would prove it is enterprise-paid. What this feed gives
the desk for free is real congestion: how many vessels sit at anchor
(SOG < 0.5 kn) outside each port right now.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

from app.config import AISSTREAM_KEY

logger = logging.getLogger("market_intel")

WS_URL = "wss://stream.aisstream.io/v0/stream"

# name → (lat_min, lon_min, lat_max, lon_max), drawn around the port plus its
# outer anchorage so waiting ships are counted, not just berthed ones.
#
# Coverage reality (probed 2026-07-29): aisstream's community receiver
# network currently hears NOTHING inside any of the origin/discharge port
# boxes — its density is Europe + Singapore. The port boxes stay subscribed
# so data appears the day a receiver does, and the Singapore Strait corridor
# (which nearly all SE Asia → China/EU rubber transits) carries live traffic
# today.
PORT_BOXES: dict[str, tuple[float, float, float, float]] = {
    "Singapore Strait (transit corridor)": (1.0, 103.3, 1.5, 104.1),
    "Laem Chabang / Bangkok": (12.9, 100.6, 13.5, 101.2),
    "Songkhla": (7.1, 100.5, 7.5, 100.8),
    "Belawan (Medan)": (3.7, 98.6, 4.1, 99.0),
    "Ho Chi Minh / Vung Tau": (10.2, 106.7, 10.9, 107.3),
    "Port Klang": (2.9, 101.1, 3.2, 101.5),
    "Qingdao": (35.8, 120.0, 36.3, 120.6),
    "Cochin": (9.8, 76.1, 10.1, 76.4),
}

ANCHORED_SOG_KN = 0.5
STALE_AFTER_S = 1800  # drop a vessel not heard from in 30 min
COUNT_EVERY_S = 600  # snapshot cadence for the congestion-trend history
COUNT_KEEP_DAYS = 8

# MMSI → {name, lat, lon, sog, port, seen}
_vessels: dict[int, dict] = {}
# MMSI → AIS ship type (from ShipStaticData; arrives minutes after positions)
_types: dict[int, int] = {}
_connected_since: float | None = None
_last_message_at: float | None = None


def _classify(mmsi: int) -> str:
    t = _types.get(mmsi)
    if t is None:
        return "unknown"
    if 70 <= t <= 79:
        return "cargo"
    if 80 <= t <= 89:
        return "tanker"
    return "other"


def _port_for(lat: float, lon: float) -> str | None:
    for name, (la1, lo1, la2, lo2) in PORT_BOXES.items():
        if la1 <= lat <= la2 and lo1 <= lon <= lo2:
            return name
    return None


async def _consume() -> None:
    global _connected_since, _last_message_at
    import websockets

    subscribe = json.dumps(
        {
            "APIKey": AISSTREAM_KEY,
            "BoundingBoxes": [[[la1, lo1], [la2, lo2]] for la1, lo1, la2, lo2 in PORT_BOXES.values()],
            # ShipStaticData carries the AIS ship type — without it every hull
            # (tug, barge, ferry) counts the same as a cargo ship.
            "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
        }
    )
    backoff = 5
    while True:
        try:
            async with websockets.connect(WS_URL, ping_interval=20, close_timeout=5) as ws:
                await ws.send(subscribe)
                _connected_since = time.time()
                backoff = 5
                logger.info("aisstream connected — %d port boxes subscribed", len(PORT_BOXES))
                async for raw in ws:
                    msg = json.loads(raw)
                    kind = msg.get("MessageType")
                    if kind == "ShipStaticData":
                        meta = msg.get("MetaData") or {}
                        static = (msg.get("Message") or {}).get("ShipStaticData") or {}
                        mmsi = meta.get("MMSI")
                        ship_type = static.get("Type")
                        if mmsi is not None and ship_type is not None:
                            _types[mmsi] = ship_type
                        continue
                    if kind != "PositionReport":
                        continue
                    meta = msg.get("MetaData") or {}
                    body = (msg.get("Message") or {}).get("PositionReport") or {}
                    lat, lon = meta.get("latitude"), meta.get("longitude")
                    mmsi = meta.get("MMSI")
                    if lat is None or lon is None or mmsi is None:
                        continue
                    port = _port_for(lat, lon)
                    if port is None:
                        continue
                    _last_message_at = time.time()
                    _vessels[mmsi] = {
                        "name": (meta.get("ShipName") or "").strip() or str(mmsi),
                        "lat": round(lat, 4),
                        "lon": round(lon, 4),
                        "sog": body.get("Sog"),
                        "port": port,
                        "seen": time.time(),
                    }
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _connected_since = None
            logger.warning("aisstream disconnected (%s) — retrying in %ds", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)


async def _record_counts() -> None:
    """Every 10 minutes, write one VesselCount row per port — the raw
    material for the 'vs 7-day average' congestion trend."""
    from datetime import datetime, timedelta, timezone

    from app.database import SessionLocal
    from app.models import VesselCount

    while True:
        await asyncio.sleep(COUNT_EVERY_S)
        try:
            snap = get_vessel_snapshot()
            db = SessionLocal()
            try:
                for p in snap["ports"]:
                    db.add(
                        VesselCount(
                            port=p["port"],
                            total=p["total"],
                            anchored=p["anchored"],
                            cargo=p["cargo"],
                            tanker=p["tanker"],
                            other=p["other"],
                            unknown=p["unknown"],
                            anchored_commodity=p["anchored_commodity"],
                        )
                    )
                cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=COUNT_KEEP_DAYS)
                db.query(VesselCount).filter(VesselCount.ts < cutoff).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()
        except Exception:
            logger.exception("Vessel count snapshot failed — next tick continues")


def start_vessel_watch() -> None:
    """Kick off the consumer + count recorder on the running event loop. No
    key, no tasks — the endpoint then reports itself unconfigured."""
    if not AISSTREAM_KEY:
        logger.info("AISSTREAM_KEY not set — vessel watch disabled")
        return
    loop = asyncio.get_event_loop()
    loop.create_task(_consume())
    loop.create_task(_record_counts())


def search_vessels(q: str) -> list[dict]:
    """Search the live in-memory store by ship name substring or MMSI.
    Only ships currently (last 30 min) inside the subscribed boxes exist
    here — there is no free global name/IMO lookup API, and scraping the
    commercial trackers is off the table."""
    q = q.strip().lower()
    if not q:
        return []
    now = time.time()
    out = []
    for mmsi, v in _vessels.items():
        if now - v["seen"] > STALE_AFTER_S:
            continue
        if q in v["name"].lower() or q == str(mmsi):
            out.append(
                {
                    **v,
                    "mmsi": mmsi,
                    "type_class": _classify(mmsi),
                    "seen_ago_s": round(now - v["seen"]),
                }
            )
    return sorted(out, key=lambda v: v["seen_ago_s"])[:20]


def get_vessel_snapshot() -> dict:
    now = time.time()
    for mmsi in [m for m, v in _vessels.items() if now - v["seen"] > STALE_AFTER_S]:
        _vessels.pop(mmsi, None)

    ports = []
    for name in PORT_BOXES:
        here = []
        for mmsi, v in _vessels.items():
            if v["port"] == name:
                here.append({**v, "type_class": _classify(mmsi)})
        anchored = [v for v in here if v["sog"] is not None and v["sog"] < ANCHORED_SOG_KN]
        moving = [v for v in here if v["sog"] is not None and v["sog"] >= ANCHORED_SOG_KN]
        commodity = [v for v in here if v["type_class"] in ("cargo", "tanker")]
        # Commodity hulls shown first — they're what could carry rubber.
        order = {"cargo": 0, "tanker": 1, "unknown": 2, "other": 3}
        ports.append(
            {
                "port": name,
                "total": len(here),
                "anchored": len(anchored),
                "moving": len(moving),
                "cargo": sum(1 for v in here if v["type_class"] == "cargo"),
                "tanker": sum(1 for v in here if v["type_class"] == "tanker"),
                "other": sum(1 for v in here if v["type_class"] == "other"),
                "unknown": sum(1 for v in here if v["type_class"] == "unknown"),
                "anchored_commodity": sum(1 for v in commodity if v["sog"] is not None and v["sog"] < ANCHORED_SOG_KN),
                "vessels": sorted(here, key=lambda v: (order[v["type_class"]], -v["seen"]))[:12],
            }
        )
    return {
        "configured": bool(AISSTREAM_KEY),
        "connected": _connected_since is not None,
        "connected_since": _connected_since,
        "last_message_age_s": round(now - _last_message_at, 1) if _last_message_at else None,
        "anchored_sog_kn": ANCHORED_SOG_KN,
        "ports": ports,
    }
