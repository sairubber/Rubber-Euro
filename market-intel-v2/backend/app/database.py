from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


if DATABASE_URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, _connection_record):
        # WAL lets the scraper write while readers keep serving requests —
        # without it every commit briefly blocks all reads (and vice versa),
        # which shows up as request stalls whenever a scrape pass lands.
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-20000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app import models  # noqa: F401  (ensure models are registered)

    Base.metadata.create_all(bind=engine)

    # create_all only builds indexes when it creates the table, so composite
    # indexes for the hot query shapes (market wall, category feed) must be
    # ensured explicitly for databases that already exist.
    with engine.begin() as conn:
        # Additive column migrations — SQLite has no "ADD COLUMN IF NOT
        # EXISTS", and dropping the table to add a field would throw away
        # the trade archive that takes ~15 minutes of paced API calls to
        # rebuild. Try, and ignore the error when the column already exists.
        for ddl in (
            "ALTER TABLE trade_flows ADD COLUMN currency VARCHAR DEFAULT 'USD'",
            "ALTER TABLE news_articles ADD COLUMN key_points TEXT",
            "ALTER TABLE news_articles ADD COLUMN image_url TEXT",
            "ALTER TABLE climate_readings ADD COLUMN forecast_7d_mm FLOAT DEFAULT 0",
        ):
            try:
                conn.exec_driver_sql(ddl)
            except Exception:
                pass

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_news_market_published "
                "ON news_articles (market_tag, published_at DESC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_news_market_category_published "
                "ON news_articles (market_tag, category, published_at DESC)"
            )
        )
