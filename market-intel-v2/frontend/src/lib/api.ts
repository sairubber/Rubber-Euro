import type { BilateralFlow, ClimateReading, CountryBreakdownItem, EUImports, FuturesQuote, FxHistoryPoint, GradeFreshness, GradeSeries, LevelEventRecord, MarketOutlook, NewsArticleRecord, NewsCategory, PortRecord, PriceBoard, PriceCandle, PriceLevels, PriceTickRecord, QuoteUpdate, RegionSignal, StatusRecord, TradeBalance, TradeMovers, TradeTimeline } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Same-origin in dev (Vite proxies /api to the backend). In hosted builds
// the API lives on another host — set VITE_API_URL to the backend origin.
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/+$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body.error ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getLatestNews: (market: string) => request<NewsArticleRecord>(`/news/latest/${market}`),
  getNewsHistory: (market: string, opts?: { limit?: number; category?: NewsCategory; hours?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.category) params.set("category", opts.category);
    if (opts?.hours) params.set("hours", String(opts.hours));
    const qs = params.toString();
    return request<NewsArticleRecord[]>(`/news/history/${market}${qs ? `?${qs}` : ""}`);
  },
  getNewsItem: (id: number | string) => request<NewsArticleRecord>(`/news/item/${id}`),
  getCountryBreakdown: (market: string, category = "trade") =>
    request<CountryBreakdownItem[]>(`/news/country-breakdown/${market}?category=${category}`),
  refreshNews: () => request<{ message: string }>("/news/refresh", { method: "POST" }),

  getClimate: () => request<ClimateReading[]>("/climate"),
  getSupplyAlerts: () => request<NewsArticleRecord[]>("/supply-alerts"),
  getRegionSignals: () => request<RegionSignal[]>("/signals/regions"),
  getMarketOutlook: () => request<MarketOutlook>("/signals/outlook"),

  getTradeBalance: () => request<TradeBalance>("/trade/balance"),
  getTradeSupply: (freq: "A" | "M" = "A") => request<TradeMovers>(`/trade/supply?freq=${freq}`),
  getTradeDemand: (freq: "A" | "M" = "A") => request<TradeMovers>(`/trade/demand?freq=${freq}`),
  getTradeTimeline: (freq: "A" | "M" = "M") => request<TradeTimeline>(`/trade/timeline?freq=${freq}`),
  getTradeFlows: () => request<BilateralFlow[]>("/trade/flows"),
  getTradeGrades: (freq: "A" | "M" = "A") => request<GradeSeries[]>(`/trade/grades?freq=${freq}`),
  getTradeFreshness: () => request<GradeFreshness[]>("/trade/freshness"),
  getEUImports: () => request<EUImports>("/trade/eu-imports"),
  refreshTrade: () => request<{ message: string }>("/trade/refresh", { method: "POST" }),

  getPriceBoard: () => request<PriceBoard>("/prices/board"),
  putQuote: (payload: QuoteUpdate) => request<FuturesQuote>("/prices/quote", { method: "PUT", body: JSON.stringify(payload) }),
  getTicks: (market: string, hours = 168) => request<PriceTickRecord[]>(`/prices/ticks/${market}?hours=${hours}`),
  getLevels: (market: string, tf?: string) => request<PriceLevels>(`/prices/levels/${market}${tf ? `?tf=${tf}` : ""}`),
  getEurusdHistory: (days = 90) => request<FxHistoryPoint[]>(`/prices/eurusd-history?days=${days}`),
  refreshSgx: () => request<{ message: string }>("/prices/refresh-sgx", { method: "POST" }),
  getFxIntraday: (pair: string) => request<PriceCandle[]>(`/prices/fx-intraday/${pair}`),
  getLevelEvents: (market: string, limit = 30) => request<LevelEventRecord[]>(`/prices/level-events/${market}?limit=${limit}`),
  getTsr20History: (days = 90) => request<PriceTickRecord[]>(`/prices/tsr20-history?days=${days}`),

  getStatus: () => request<StatusRecord>("/status"),
  getPorts: () => request<PortRecord[]>("/ports"),
};
