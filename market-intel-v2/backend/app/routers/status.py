from fastapi import APIRouter

from app.config import NEWS_API_KEY, REFRESH_MINUTES
from app.markets import MARKETS
from app.scheduler import get_scrape_status, is_scheduler_running
from app.schemas import StatusOut

router = APIRouter(tags=["status"])


@router.get("/status", response_model=StatusOut)
def get_status():
    scrape_status = get_scrape_status()
    return StatusOut(
        scheduler_running=is_scheduler_running(),
        markets=list(MARKETS.keys()),
        refresh_minutes=REFRESH_MINUTES,
        news_api_configured=bool(NEWS_API_KEY),
        last_scrape_at=scrape_status["last_scrape_at"],
        last_scrape_added=scrape_status["last_scrape_added"],
        last_climate_at=scrape_status["last_climate_at"],
    )
