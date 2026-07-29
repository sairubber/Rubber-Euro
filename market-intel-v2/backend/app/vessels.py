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

# MMSI → {name, lat, lon, sog, port, seen}
_vessels: dict[int, dict] = {}
_connected_since: float | None = None
_last_message_at: float | None = None


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
            "FilterMessageTypes": ["PositionReport"],
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
                    if msg.get("MessageType") != "PositionReport":
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


def start_vessel_watch() -> None:
    """Kick off the consumer on the running event loop. No key, no task —
    the endpoint then reports itself unconfigured."""
    if not AISSTREAM_KEY:
        logger.info("AISSTREAM_KEY not set — vessel watch disabled")
        return
    asyncio.get_event_loop().create_task(_consume())


def get_vessel_snapshot() -> dict:
    now = time.time()
    for mmsi in [m for m, v in _vessels.items() if now - v["seen"] > STALE_AFTER_S]:
        _vessels.pop(mmsi, None)

    ports = []
    for name in PORT_BOXES:
        here = [v for v in _vessels.values() if v["port"] == name]
        anchored = [v for v in here if v["sog"] is not None and v["sog"] < ANCHORED_SOG_KN]
        moving = [v for v in here if v["sog"] is not None and v["sog"] >= ANCHORED_SOG_KN]
        ports.append(
            {
                "port": name,
                "total": len(here),
                "anchored": len(anchored),
                "moving": len(moving),
                "vessels": sorted(here, key=lambda v: -v["seen"])[:12],
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
