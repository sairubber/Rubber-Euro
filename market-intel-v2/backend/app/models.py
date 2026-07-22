from datetime import datetime, timezone

from sqlalchemy import Boolean, Float, Integer, String, Text, DateTime, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class NewsArticle(Base):
    """Real news, scraped from Google News RSS (no API key) and optionally
    NewsAPI.org. `category` distinguishes general headlines from the
    trade/export and disruption/disease niche feeds."""

    __tablename__ = "news_articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    title_normalized: Mapped[str] = mapped_column(String, nullable=False, index=True)  # lowercased/stripped, for cross-source dedup
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    source_name: Mapped[str] = mapped_column(String, nullable=False, default="")
    market_tag: Mapped[str] = mapped_column(String, nullable=False, index=True)  # 'TSR20' | 'EURUSD'
    category: Mapped[str] = mapped_column(String, nullable=False, default="headline", index=True)  # headline | trade | disruption
    country: Mapped[str | None] = mapped_column(String, nullable=True, index=True)  # detected producing-country mention, if any
    original_language: Mapped[str | None] = mapped_column(String, nullable=True)  # set only when title/description were translated
    # Newline-separated bullets extracted verbatim from the article body by
    # analyzer.py. Never model-written — see that module's docstring.
    key_points: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Lead image (og:image) from the article's own page — fills the card
    # space that a bullet-less story would otherwise leave empty.
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class TradeFlow(Base):
    """Official UN Comtrade customs records for HS 4001 (natural rubber).

    Every row is a government-filed declaration, kept permanently — the table
    is the historical archive the supply/demand analysis reads from, so
    year-over-year and month-over-month comparisons get deeper the longer the
    site runs rather than resetting each refresh.

    (reporter_code, partner_code, flow, freq, period) is unique: a refresh
    overwrites the value for a period it already holds (Comtrade revises
    figures) instead of duplicating it.
    """

    __tablename__ = "trade_flows"
    __table_args__ = (
        UniqueConstraint(
            "reporter_code", "partner_code", "flow", "freq", "period", "hs_code",
            name="uq_trade_flow_record",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reporter_code: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    reporter_name: Mapped[str] = mapped_column(String, nullable=False)
    partner_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0 = World
    partner_name: Mapped[str] = mapped_column(String, nullable=False, default="World")
    flow: Mapped[str] = mapped_column(String, nullable=False, index=True)  # X = export/supply, M = import/demand
    freq: Mapped[str] = mapped_column(String, nullable=False, index=True)  # A = annual, M = monthly
    hs_code: Mapped[str] = mapped_column(String, nullable=False, index=True)  # 400110/400121/400122/400129
    grade: Mapped[str] = mapped_column(String, nullable=False)  # human label for hs_code
    period: Mapped[str] = mapped_column(String, nullable=False, index=True)  # YYYY or YYYYMM
    value_usd: Mapped[float] = mapped_column(Float, nullable=False)  # in `currency`
    # Comtrade reports USD, Eurostat reports EUR. No FX conversion is applied
    # — converting would bake a rate into stored history and quietly change
    # past figures every refresh. Instead the currency travels with the row
    # and the analysis layer never sums across sources.
    currency: Mapped[str] = mapped_column(String, nullable=False, default="USD")
    qty_kg: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_estimated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source: Mapped[str] = mapped_column(String, nullable=False, index=True, default="un-comtrade")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ClimateReading(Base):
    """Real rainfall data from Open-Meteo (open, no API key required) per producing region."""

    __tablename__ = "climate_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    region: Mapped[str] = mapped_column(String, nullable=False, index=True)
    reading_date: Mapped[str] = mapped_column(String, nullable=False)  # YYYY-MM-DD
    rainfall_mm: Mapped[float] = mapped_column(Float, nullable=False)
    rainfall_7d_avg_mm: Mapped[float] = mapped_column(Float, nullable=False)
    disruption_score: Mapped[float] = mapped_column(Float, nullable=False)  # 0-100, derived from rainfall anomaly
    source: Mapped[str] = mapped_column(String, nullable=False, default="open-meteo")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
