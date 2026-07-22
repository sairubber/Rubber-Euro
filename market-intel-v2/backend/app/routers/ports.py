from fastapi import APIRouter

from app.markets import PORTS

router = APIRouter(tags=["ports"])


@router.get("/ports")
def get_ports():
    return [{"name": name, "lat": coords["lat"], "lon": coords["lon"]} for name, coords in PORTS.items()]
