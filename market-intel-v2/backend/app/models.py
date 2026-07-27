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


class FuturesQuote(Base):
    """One contract-month row of the manually maintained SGX TSR20 board.

    SGX does not expose a free real-time TSR20 feed, so the desk keys these
    numbers in (same workflow as the Google Sheet this mirrors). Everything
    derivable is derived, never stored: change = price - close (last
    settlement), pct change = change / close, previous OI = OI - OI change.
    """

    __tablename__ = "futures_quotes"
    __table_args__ = (UniqueConstraint("market_tag", "contract_month", name="uq_quote_contract"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    market_tag: Mapped[str] = mapped_column(String, nullable=False, index=True)  # 'TSR20'
    contract_month: Mapped[str] = mapped_column(String, nullable=False)  # 'August'
    month_order: Mapped[int] = mapped_column(Integer, nullable=False)  # sort key: 8, 9, 10, 11
    price: Mapped[float] = mapped_column(Float, nullable=False)  # current market price (T)
    open: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    high: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    low: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # Vcon
    close: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # closing price (L.S)
    open_interest: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    oi_change: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class PriceTick(Base):
    """Price history point. For TSR20 a tick is recorded only when the front
    month moves >= TICK_THRESHOLD ($10) from the last stored tick — the board
    updates on every $10 of movement, and this history is what the intraday
    chart and the proven support/resistance detection read from. FX pairs get
    a tick per scheduler fetch when the rate actually moved."""

    __tablename__ = "price_ticks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    market_tag: Mapped[str] = mapped_column(String, nullable=False, index=True)  # 'TSR20' | 'EURUSD' | ...
    price: Mapped[float] = mapped_column(Float, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class LevelEvent(Base):
    """A support/resistance break the market actually made.

    Written the moment an observed price crosses a computed level, together
    with a rule-based explanation of the scenario at that time (which level,
    how proven it was, what the standard reading of the break is, and the
    next computed level in the direction of the move). Never model-written —
    every sentence is assembled from the stored numbers."""

    __tablename__ = "level_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    market_tag: Mapped[str] = mapped_column(String, nullable=False, index=True)
    level_price: Mapped[float] = mapped_column(Float, nullable=False)
    level_label: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # support | resistance
    direction: Mapped[str] = mapped_column(String, nullable=False)  # break_above | break_below
    proven: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    strength: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    price_before: Mapped[float] = mapped_column(Float, nullable=False)
    price_after: Mapped[float] = mapped_column(Float, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class PhysicalPrice(Base):
    """Official daily physical (spot) rubber prices published by the Rubber
    Board of India — per 100 kg, INR and USD, per market location. One row
    per (location, grade, date), so the table accumulates a real spot-price
    history the longer the site runs."""

    __tablename__ = "physical_prices"
    __table_args__ = (UniqueConstraint("location", "grade", "price_date", name="uq_physical_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location: Mapped[str] = mapped_column(String, nullable=False, index=True)  # Kottayam | Kochi | Agartala
    grade: Mapped[str] = mapped_column(String, nullable=False)  # RSS4 | RSS5 | ...
    inr: Mapped[float] = mapped_column(Float, nullable=False)  # ₹ per 100 kg
    usd: Mapped[float | None] = mapped_column(Float, nullable=True)  # $ per 100 kg
    price_date: Mapped[str] = mapped_column(String, nullable=False, index=True)  # YYYY-MM-DD
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class FxRate(Base):
    """Latest live FX rate per pair, fetched from the free open.er-api.com
    endpoint (no key). One row per pair, overwritten each refresh; the
    previous value is kept so the board can show direction."""

    __tablename__ = "fx_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair: Mapped[str] = mapped_column(String, nullable=False, unique=True)  # 'EURUSD', 'USDIDR', ...
    rate: Mapped[float] = mapped_column(Float, nullable=False)
    prev_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
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
