import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.config import CORS_ORIGINS
from app.database import init_db
from app.routers import analytics, news, ports, status, trade
from app.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("market_intel")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        start_scheduler()
    except Exception:
        logger.exception("Failed to start scheduler — jobs will not run, but the API stays up")
    yield
    shutdown_scheduler()


app = FastAPI(
    title="The Research Wire — TSR20 + EUR/USD News",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(news.router, prefix="/api")
app.include_router(status.router, prefix="/api")
app.include_router(ports.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(trade.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
