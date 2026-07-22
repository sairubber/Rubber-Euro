import type { BilateralFlow, ClimateReading, CountryBreakdownItem, EUImports, GradeFreshness, GradeSeries, MarketOutlook, NewsArticleRecord, NewsCategory, PortRecord, RegionSignal, StatusRecord, TradeBalance, TradeMovers, TradeTimeline } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
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
  getNewsHistory: (market: string, opts?: { limit?: number; category?: NewsCategory }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.category) params.set("category", opts.category);
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

  getStatus: () => request<StatusRecord>("/status"),
  getPorts: () => request<PortRecord[]>("/ports"),
};
