from pydantic import BaseModel


class NewsArticleOut(BaseModel):
    id: int
    title: str
    description: str
    url: str
    source_name: str
    market_tag: str
    category: str
    original_language: str | None
    credibility: str  # verified | trusted | unrated — see credibility.py
    country: str | None  # detected producing-country mention, TSR20 filtering
    key_points: list[str]  # verbatim sentences from the article, never generated
    image_url: str | None
    published_at: str


class ClimateReadingOut(BaseModel):
    region: str
    country: str
    lat: float
    lon: float
    reading_date: str
    rainfall_mm: float
    rainfall_7d_avg_mm: float
    disruption_score: float
    source: str


class RunTriggeredOut(BaseModel):
    message: str


class StatusOut(BaseModel):
    scheduler_running: bool
    markets: list[str]
    refresh_minutes: int
    news_api_configured: bool
    last_scrape_at: str | None
    last_scrape_added: int
    last_climate_at: str | None


class RegionSignalOut(BaseModel):
    region: str
    country: str
    risk_level: str
    composite_score: float
    climate_score: float
    news_article_count: int
    trend: str
    rationale: str


class MarketOutlookOut(BaseModel):
    headline: str
    summary: str
    elevated_region_count: int
    worsening_region_count: int
    total_regions: int


class CountryBreakdownItem(BaseModel):
    country: str
    count: int


class TradeMoverRow(BaseModel):
    country: str
    value_usd: float
    qty_kg: float
    prior_value_usd: float | None
    change_pct: float | None
    qty_change_pct: float | None


class TradeMoversOut(BaseModel):
    latest_period: str | None
    prior_period: str | None
    rows: list[TradeMoverRow]


class TimelineEntry(BaseModel):
    country: str
    value_usd: float
    qty_kg: float


class TimelineFrame(BaseModel):
    period: str
    supply: list[TimelineEntry]
    demand: list[TimelineEntry]


class TradeTimelineOut(BaseModel):
    freq: str
    frames: list[TimelineFrame]
    supply_countries: list[str]
    demand_countries: list[str]


class BilateralFlowOut(BaseModel):
    period: str
    exporter: str
    importer: str
    value_usd: float
    qty_kg: float


class TradeBalanceOut(BaseModel):
    supply_period: str | None
    supply_prior_period: str | None
    demand_period: str | None
    demand_prior_period: str | None
    supply_total_usd: float
    demand_total_usd: float
    supply_change_pct: float | None
    demand_change_pct: float | None
    supply_country_count: int
    demand_country_count: int
    rising_demand: list[str]
    rising_supply: list[str]


class GradePoint(BaseModel):
    period: str
    value_usd: float
    qty_kg: float
    reporters: int


class GradeTopProducer(BaseModel):
    country: str
    value_usd: float
    qty_kg: float


class GradeSeriesOut(BaseModel):
    hs_code: str
    grade: str
    freq: str
    points: list[GradePoint]
    latest_period: str
    latest_value_usd: float
    latest_qty_kg: float
    change_pct: float | None
    qty_change_pct: float | None
    top_producers: list[GradeTopProducer]


class GradeFreshnessOut(BaseModel):
    hs_code: str
    grade: str
    latest_complete_year: str | None
    latest_filed_year: str | None
    latest_filed_year_reporters: int
    latest_filed_month: str | None


class EUImportRow(BaseModel):
    country: str
    value_eur: float
    qty_kg: float
    change_pct: float | None


class EUMonthPoint(BaseModel):
    period: str
    value_eur: float
    qty_kg: float


class EUImportsOut(BaseModel):
    latest_period: str | None
    prior_period: str | None
    currency: str
    rows: list[EUImportRow]
    months: list[EUMonthPoint]


class ErrorOut(BaseModel):
    error: str
