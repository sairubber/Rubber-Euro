export type Market = "TSR20" | "EURUSD";
export type NewsCategory = "headline" | "trade" | "disruption";

export type Credibility = "verified" | "trusted" | "unrated";

export interface NewsArticleRecord {
  id: number;
  title: string;
  description: string;
  url: string;
  source_name: string;
  market_tag: string;
  category: NewsCategory;
  original_language: string | null;
  credibility: Credibility;
  country: string | null;
  key_points: string[];
  image_url: string | null;
  published_at: string;
}

export interface ClimateReading {
  region: string;
  country: string;
  lat: number;
  lon: number;
  reading_date: string;
  rainfall_mm: number;
  rainfall_7d_avg_mm: number;
  forecast_7d_mm: number;
  disruption_score: number;
  source: string;
}

export type RiskLevel = "Low" | "Moderate" | "Elevated" | "High";

export interface RegionSignal {
  region: string;
  country: string;
  risk_level: RiskLevel;
  composite_score: number;
  climate_score: number;
  news_article_count: number;
  trend: "Worsening" | "Improving" | "Steady" | "No prior reading";
  rationale: string;
}

export interface MarketOutlook {
  headline: string;
  summary: string;
  elevated_region_count: number;
  worsening_region_count: number;
  total_regions: number;
}

export interface CountryBreakdownItem {
  country: string;
  count: number;
}

export interface TradeMoverRow {
  country: string;
  value_usd: number;
  qty_kg: number;
  prior_value_usd: number | null;
  change_pct: number | null;
  qty_change_pct: number | null;
}

export interface TradeMovers {
  latest_period: string | null;
  prior_period: string | null;
  rows: TradeMoverRow[];
}

export interface TimelineEntry {
  country: string;
  value_usd: number;
  qty_kg: number;
}

export interface TimelineFrame {
  period: string;
  supply: TimelineEntry[];
  demand: TimelineEntry[];
}

export interface TradeTimeline {
  freq: string;
  frames: TimelineFrame[];
  supply_countries: string[];
  demand_countries: string[];
}

export interface BilateralFlow {
  period: string;
  exporter: string;
  importer: string;
  value_usd: number;
  qty_kg: number;
}

export interface TradeBalance {
  supply_period: string | null;
  supply_prior_period: string | null;
  demand_period: string | null;
  demand_prior_period: string | null;
  supply_total_usd: number;
  demand_total_usd: number;
  supply_change_pct: number | null;
  demand_change_pct: number | null;
  supply_country_count: number;
  demand_country_count: number;
  rising_demand: string[];
  rising_supply: string[];
}

export interface GradePoint {
  period: string;
  value_usd: number;
  qty_kg: number;
  reporters: number;
}

export interface GradeTopProducer {
  country: string;
  value_usd: number;
  qty_kg: number;
}

export interface GradeSeries {
  hs_code: string;
  grade: string;
  freq: string;
  points: GradePoint[];
  latest_period: string;
  latest_value_usd: number;
  latest_qty_kg: number;
  change_pct: number | null;
  qty_change_pct: number | null;
  top_producers: GradeTopProducer[];
}

export interface GradeFreshness {
  hs_code: string;
  grade: string;
  latest_complete_year: string | null;
  latest_filed_year: string | null;
  latest_filed_year_reporters: number;
  latest_filed_month: string | null;
}

export interface EUImportRow {
  country: string;
  value_eur: number;
  qty_kg: number;
  change_pct: number | null;
}

export interface EUMonthPoint {
  period: string;
  value_eur: number;
  qty_kg: number;
}

export interface EUImports {
  latest_period: string | null;
  prior_period: string | null;
  currency: string;
  rows: EUImportRow[];
  months: EUMonthPoint[];
}

export interface PortRecord {
  name: string;
  lat: number;
  lon: number;
}

export interface FuturesQuote {
  market_tag: string;
  contract_month: string;
  month_order: number;
  price: number;
  change: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  close: number;
  open_interest: number;
  oi_change: number;
  prev_open_interest: number;
  price_change_pct: number;
  updated_at: string | null;
}

export interface FxRateRecord {
  pair: string;
  rate: number;
  prev_rate: number | null;
  change_pct: number | null;
  fetched_at: string | null;
}

export interface PriceBoard {
  sgx_synced_at: string | null;
  sgx_price_as_of: string | null;
  shanghai_synced_at: string | null;
  quotes: FuturesQuote[];
  shanghai: FuturesQuote[];
  fx: FxRateRecord[];
}

export interface PriceTickRecord {
  price: number;
  ts: string;
}

export interface PriceCandle {
  ts: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LevelEventRecord {
  id: number;
  market_tag: string;
  level_price: number;
  level_label: string;
  kind: "support" | "resistance";
  direction: "break_above" | "break_below";
  proven: boolean;
  strength: number;
  price_before: number;
  price_after: number;
  explanation: string;
  ts: string;
}

export interface PriceLevel {
  price: number;
  kind: "support" | "resistance";
  label: string;
  proven: boolean;
  strength: number;
  reason: string;
}

export interface PriceLevels {
  market_tag: string;
  current_price: number | null;
  session: string;
  levels: PriceLevel[];
  computed_at?: string;
}

export interface FxHistoryPoint {
  date: string;
  rate: number;
}

export interface PhysicalPrices {
  price_date: string | null;
  unit?: string;
  source?: string;
  locations: { location: string; price_date?: string; rows: { grade: string; inr: number; usd: number | null }[] }[];
}

export interface QuoteUpdate {
  market_tag: string;
  contract_month: string;
  month_order?: number;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  close?: number;
  open_interest?: number;
  oi_change?: number;
}

export interface StatusRecord {
  scheduler_running: boolean;
  markets: string[];
  refresh_minutes: number;
  news_api_configured: boolean;
  last_scrape_at: string | null;
  last_scrape_added: number;
  last_climate_at: string | null;
}

// --- Desk (basis, spreads, origin) ---

export interface BasisPhysical {
  location: string;
  grade: string;
  label: string;
  kind: "block" | "sheet";
  usd_mt: number;
  price_date: string;
  basis: number;
  basis_ine: number | null;
}

export interface ShanghaiLeg {
  front_month: string;
  cny_price: number;
  usd_price: number;
  fx_rate: number;
}

export interface BasisSpread {
  label: string;
  note: string;
  value: number;
}

export interface BasisHistoryPoint {
  date: string;
  sgx_settle: number;
  smr20?: number;
  isnr20?: number;
  str20?: number;
  basis_smr20?: number;
  basis_isnr20?: number;
  basis_str20?: number;
}

export interface BasisSnapshot {
  front_month: string;
  sgx_price: number;
  sgx_close: number;
  sgx_price_as_of: string | null;
  unit: string;
  shanghai: ShanghaiLeg | null;
  physicals: BasisPhysical[];
  spreads: BasisSpread[];
  history: BasisHistoryPoint[];
  source: string;
}

export interface PhysicalHistoryPoint {
  price_date: string;
  inr: number;
  usd: number | null;
}

export interface WarrantStockPoint {
  date: string;
  tonnes: number;
  change: number;
}

export interface WarrantStocks {
  unit: string;
  contract: string;
  source: string;
  series: WarrantStockPoint[];
}

export interface BulletinFutures {
  sgx_front_month: string;
  sgx_price: number;
  sgx_close: number;
  sgx_change: number | null;
  sgx_curve: string;
  ine_front_cny: number | null;
  ine_front_usd: number | null;
  ine_curve: string;
  exchange_spread: number | null;
  sgx_price_as_of: string | null;
}

export interface BulletinStocks {
  date: string;
  tonnes: number;
  daily_change: number;
  month_change: number;
  window_low: number;
  window_high: number;
  window_position_pct: number | null;
}

export interface EnsoState {
  season: string;
  year: number;
  anomaly: number;
  phase: string;
}

export interface DeskBulletin {
  generated_at: string;
  edition: string;
  futures: BulletinFutures | null;
  physicals: { label: string; grade: string; usd_mt: number; price_date: string; basis: number }[];
  fx: { pair: string; rate: number; change_pct: number | null }[];
  stocks: BulletinStocks | null;
  tapping_season: string;
  rain_hit: { region: string; rainfall_mm: number }[];
  enso: EnsoState | null;
  headlines: { title: string; source: string; url: string }[];
}

export interface VesselRecord {
  name: string;
  lat: number;
  lon: number;
  sog: number | null;
  port: string;
  seen: number;
}

export interface VesselPort {
  port: string;
  total: number;
  anchored: number;
  moving: number;
  vessels: VesselRecord[];
}

export interface VesselSnapshot {
  configured: boolean;
  connected: boolean;
  connected_since: number | null;
  last_message_age_s: number | null;
  anchored_sog_kn: number;
  ports: VesselPort[];
}

export interface ThaiFobPoint {
  price_date: string;
  thb_kg: number;
  usd_mt: number | null;
}

export interface ThaiFob {
  source: string;
  latest: { price_date: string; thb_kg: number; usd_mt: number | null } | null;
  series: ThaiFobPoint[];
}
