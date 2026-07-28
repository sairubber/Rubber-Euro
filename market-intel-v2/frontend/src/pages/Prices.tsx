import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ShieldCheck, Zap } from "lucide-react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { api } from "@/lib/api";
import { SHOW_EURUSD } from "@/lib/markets";
import { cn, relativeTime } from "@/lib/utils";
import { FeedSkeleton } from "@/components/ui/Skeleton";
import type { FuturesQuote, LevelEventRecord, PriceCandle, PriceLevel, PriceTickRecord, QuoteUpdate } from "@/lib/types";

/** The desk board: live charts, rule-based support/resistance with the
 * reason each level qualifies, and the same two tables the desk keeps in
 * its sheet — keyed in here instead (SGX has no free TSR20 feed), with
 * every derivable column derived, never typed. A front-month move of $10+
 * lands a tick, and ticks are what the intraday chart and the "proven"
 * levels are computed from. */

// ── Editable cell ────────────────────────────────────────────────────────────

function EditCell({
  value,
  onCommit,
  decimals = 0,
}: {
  value: number;
  onCommit: (v: number) => void;
  decimals?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value.toFixed(decimals);
  return (
    <input
      type="number"
      value={shown}
      step={decimals ? 10 ** -decimals : 1}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        if (draft !== null && draft !== "" && Number(draft) !== value) onCommit(Number(draft));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className="num w-full bg-transparent text-right text-[12px] text-text px-1 py-0.5 border border-transparent hover:border-border-subtle focus:border-accent focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}

function DerivedCell({ value, signed = false, suffix = "" }: { value: number; signed?: boolean; suffix?: string }) {
  const tone = value > 0 ? "text-bull" : value < 0 ? "text-bear" : "text-text-dim";
  return (
    <span className={cn("num text-[12px]", signed ? tone : "text-text-dim")}>
      {signed && value > 0 ? "+" : ""}
      {Number.isInteger(value) ? value : value.toFixed(2)}
      {suffix}
    </span>
  );
}

// ── Support / resistance panel ───────────────────────────────────────────────

function LevelRow({ level, decimals }: { level: PriceLevel; decimals: number }) {
  const isSupport = level.kind === "support";
  return (
    <div className="py-2 border-b border-border-subtle last:border-0">
      <div className="flex items-center gap-2">
        <span className={cn("num text-[13px] font-bold", isSupport ? "text-bull" : "text-bear")}>
          {level.price.toFixed(decimals)}
        </span>
        <span className="kicker text-[9px] text-text-dim">{level.label}</span>
        {level.proven && (
          <span className="kicker text-[8px] flex items-center gap-0.5 text-accent border border-accent/40 px-1 py-px">
            <ShieldCheck size={9} /> proven ×{level.strength}
          </span>
        )}
      </div>
      <p className="text-[11px] text-text-faint leading-relaxed mt-0.5">{level.reason}</p>
    </div>
  );
}

// Chart timeframes whose pivot sets TradingView's engine serves — the panel
// mirrors whichever timeframe the user reads the chart at.
const PIVOT_TFS = ["15m", "1h", "4h", "1d", "1w", "1mo"];

function LevelsPanel({ market, decimals }: { market: string; decimals: number }) {
  const isFx = market === "EURUSD";
  const [tf, setTf] = useState<string>(() => localStorage.getItem("eurusd-pivot-tf") ?? "15m");
  const pickTf = (v: string) => {
    setTf(v);
    localStorage.setItem("eurusd-pivot-tf", v);
  };
  const { data } = useQuery({
    queryKey: ["levels", market, isFx ? tf : ""],
    queryFn: () => api.getLevels(market, isFx ? tf : undefined),
    refetchInterval: 30_000,
  });
  if (!data) return <FeedSkeleton rows={3} />;
  const supports = data.levels.filter((l) => l.kind === "support");
  const resistances = data.levels.filter((l) => l.kind === "resistance");
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
      {isFx && (
        <div className="sm:col-span-2 flex items-center gap-1 mb-2 flex-wrap">
          <span className="kicker text-[9px] text-text-faint mr-1">Pivot timeframe (match the chart):</span>
          {PIVOT_TFS.map((v) => (
            <button
              key={v}
              onClick={() => pickTf(v)}
              className={cn(
                "kicker text-[10px] px-2 py-0.5 border transition-colors uppercase",
                tf === v ? "border-eurusd text-eurusd bg-eurusd-dim" : "border-border-subtle text-text-faint hover:text-text"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      <div>
        <p className="kicker text-[10px] text-bear mb-1">Resistance · above {data.current_price?.toFixed(decimals)}</p>
        {resistances.length === 0 && <p className="text-[11px] text-text-faint py-2">None computed yet.</p>}
        {resistances.map((l, i) => (
          <LevelRow key={`r${i}`} level={l} decimals={decimals} />
        ))}
      </div>
      <div>
        <p className="kicker text-[10px] text-bull mb-1">Support · below {data.current_price?.toFixed(decimals)}</p>
        {supports.length === 0 && <p className="text-[11px] text-text-faint py-2">None computed yet.</p>}
        {supports.map((l, i) => (
          <LevelRow key={`s${i}`} level={l} decimals={decimals} />
        ))}
      </div>
      <p className="kicker text-[8px] text-text-faint sm:col-span-2 mt-2">
        {data.session} · rule-based (pivots, session extremes, tick reversals, round numbers) — no model, every level carries its arithmetic reason
      </p>
    </div>
  );
}

// ── Charts ───────────────────────────────────────────────────────────────────

/** The real TradingView embed — used for EUR/USD, which TradingView's free
 * widget licenses (SGX/TSR20 it does not). Streams on its own; the embed
 * can't draw external overlays, so our S/R levels live in the panel below. */
function TradingViewChart({ symbol, interval }: { symbol: string; interval: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    container.appendChild(widget);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Asia/Kolkata",
      theme: "light",
      style: "1",
      locale: "en",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      // TradingView's own Pivot Points Standard study — the same classic
      // floor pivots (P/R1/R2/S1/S2) our engine computes, drawn natively on
      // the chart since the embed accepts no external overlays.
      // NOTE: studies_overrides for the pivot colors was tried and broke the
      // embed (study + toolbar failed to load) — the free widget doesn't
      // accept per-plot study overrides. Pivot colors can be changed from
      // the chart's own settings gear, and survive navigation because the
      // page keeps this iframe alive.
      studies: ["STD;Pivot%1Points%1Standard"],
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);
    return () => {
      container.innerHTML = "";
    };
  }, [symbol, interval]);
  // The embed script rewrites the widget container's own height to 100%, so
  // the size must live on a wrapper OUTSIDE it — viewport-relative with a
  // floor, which is what keeps the chart tall on any screen.
  return (
    <div style={{ height: "max(70vh, 560px)" }}>
      <div className="tradingview-widget-container" ref={ref} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}

/** TradingView chart, self-hosted: this is TradingView's own open-source
 * Lightweight Charts engine (the embed widget can't carry SGX data — the
 * exchange doesn't license it to free embeds — and can't draw our levels).
 * Running the engine ourselves gets both: the TradingView look and every
 * computed support/resistance drawn on the chart as a labelled price line —
 * solid when proven, dashed when theoretical. */
function LWChart({
  candles,
  line,
  levels,
  decimals,
  storageKey = "lw-chart-range",
}: {
  candles?: PriceCandle[];
  line?: PriceTickRecord[];
  levels: PriceLevel[];
  decimals: number;
  storageKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const toTime = (ts: string) => Math.floor(new Date(ts).getTime() / 1000) as UTCTimestamp;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8271",
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#00000012" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { labelVisible: true }, vertLine: { labelVisible: true } },
    });
    chartRef.current = chart;

    const priceFormat = { type: "price" as const, precision: decimals, minMove: decimals ? 10 ** -decimals : 1 };
    const seen = new Set<number>();
    const dedupe = <T extends { time: UTCTimestamp }>(rows: T[]) =>
      rows.filter((r) => (seen.has(r.time) ? false : (seen.add(r.time), true))).sort((a, b) => a.time - b.time);

    // Autoscale normally fits the series alone, which clips S/R lines sitting
    // outside the traded range — the whole point of drawing them. Stretch the
    // scale to include every level near the last price (TSR20 trades a wide
    // dollar range; FX needs a tighter band or the candles squash flat).
    const lastPrice = candles?.length ? candles[candles.length - 1].close : line?.length ? line[line.length - 1].price : null;
    const nearBand = lastPrice ? lastPrice * (decimals === 0 ? 0.03 : 0.006) : 0;
    const nearLevels = lastPrice ? levels.filter((l) => Math.abs(l.price - lastPrice) <= nearBand) : [];
    const autoscaleInfoProvider = (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
      const res = original();
      if (!res || nearLevels.length === 0) return res;
      return {
        priceRange: {
          minValue: Math.min(res.priceRange.minValue, ...nearLevels.map((l) => l.price)),
          maxValue: Math.max(res.priceRange.maxValue, ...nearLevels.map((l) => l.price)),
        },
      };
    };

    let anyData = false;
    if (candles && candles.length > 0) {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: "#1e7a45",
        downColor: "#b3352f",
        borderVisible: false,
        wickUpColor: "#1e7a45",
        wickDownColor: "#b3352f",
        priceFormat,
        autoscaleInfoProvider,
      });
      s.setData(dedupe(candles.map((c) => ({ time: toTime(c.ts), open: c.open, high: c.high, low: c.low, close: c.close }))));
      levels.forEach((l) =>
        s.createPriceLine({
          price: l.price,
          color: l.kind === "support" ? "#1e7a45" : "#b3352f",
          lineWidth: 1,
          lineStyle: l.proven ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${l.label}${l.proven ? ` ×${l.strength}` : ""}`,
        })
      );
      anyData = true;
    } else if (line && line.length > 0) {
      const s = chart.addSeries(AreaSeries, {
        lineColor: "#2f6b4f",
        topColor: "rgba(47,107,79,0.25)",
        bottomColor: "rgba(47,107,79,0.02)",
        lineWidth: 2,
        priceFormat,
        autoscaleInfoProvider,
      });
      s.setData(dedupe(line.map((t) => ({ time: toTime(t.ts), value: t.price }))));
      levels.forEach((l) =>
        s.createPriceLine({
          price: l.price,
          color: l.kind === "support" ? "#1e7a45" : "#b3352f",
          lineWidth: 1,
          lineStyle: l.proven ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${l.label}${l.proven ? ` ×${l.strength}` : ""}`,
        })
      );
      anyData = true;
    }
    if (anyData) {
      // Auto-save the view: zoom/pan is written to localStorage on every
      // change and restored here — surviving both the 30s data refreshes
      // (which rebuild the chart) and full page reloads. The saved range is
      // only trusted when the series is roughly the same size it was saved
      // against — a view saved during a transient 2-point render must not
      // pin a later 90-point series to its first two bars.
      const len = (candles?.length ?? 0) + (line?.length ?? 0);
      let restored = false;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
        if (saved?.r && typeof saved.n === "number" && Math.abs(saved.n - len) <= Math.max(10, len * 0.15)) {
          chart.timeScale().setVisibleLogicalRange(saved.r);
          restored = true;
        }
      } catch {
        /* corrupted saved range — fall through to fitContent */
      }
      if (!restored) chart.timeScale().fitContent();
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) localStorage.setItem(storageKey, JSON.stringify({ r: range, n: len }));
      });
    }

    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [candles, line, levels, decimals, storageKey]);

  const empty = !(candles && candles.length) && !(line && line.length);
  return (
    <div className="relative">
      <div ref={ref} className="h-[440px] md:h-[600px]" />
      {empty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[11px] text-text-faint px-6 text-center">
            Line starts drawing as soon as the feed shows movement — every observed price lands here.
          </p>
        </div>
      )}
    </div>
  );
}

/** Bucket a price series into OHLC candles. Buckets holding several observed
 * prices carry a real range; a single-point bucket (e.g. one settlement per
 * day) opens at the previous close so the body still shows the day's real
 * move — every number is an observed price, nothing is invented. */
function toCandles(points: PriceTickRecord[], bucketSec: number): PriceCandle[] {
  const buckets = new Map<number, { o: number; h: number; l: number; c: number; ts: string }>();
  for (const p of points) {
    const t = Math.floor(new Date(p.ts).getTime() / 1000 / bucketSec) * bucketSec;
    const b = buckets.get(t);
    if (!b) buckets.set(t, { o: p.price, h: p.price, l: p.price, c: p.price, ts: new Date(t * 1000).toISOString() });
    else {
      b.h = Math.max(b.h, p.price);
      b.l = Math.min(b.l, p.price);
      b.c = p.price;
    }
  }
  const out = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  for (let i = 1; i < out.length; i++) {
    if (out[i].o === out[i].c && out[i].h === out[i].l) {
      out[i].o = out[i - 1].c;
      out[i].h = Math.max(out[i].o, out[i].c);
      out[i].l = Math.min(out[i].o, out[i].c);
    }
  }
  return out.map((b) => ({ ts: b.ts, price: b.c, open: b.o, high: b.h, low: b.l, close: b.c }));
}

// Intraday frames bucket the 2-min live ticks; daily frames bucket SGX
// settlements; 1Y+ roll up to weekly candles so a year stays readable.
const TSR_TIMEFRAMES: Record<string, { cutoffHours: number; bucketSec: number }> = {
  "15M": { cutoffHours: 48, bucketSec: 15 * 60 },
  "3H": { cutoffHours: 24 * 10, bucketSec: 3 * 3600 },
  "4H": { cutoffHours: 24 * 14, bucketSec: 4 * 3600 },
  "6H": { cutoffHours: 24 * 21, bucketSec: 6 * 3600 },
  "1D": { cutoffHours: 24, bucketSec: 15 * 60 },
  "5D": { cutoffHours: 24 * 5, bucketSec: 3600 },
  "1W": { cutoffHours: 24 * 7, bucketSec: 2 * 3600 },
  "1M": { cutoffHours: 24 * 31, bucketSec: 24 * 3600 },
  "3M": { cutoffHours: 24 * 93, bucketSec: 24 * 3600 },
  "6M": { cutoffHours: 24 * 186, bucketSec: 24 * 3600 },
  "1Y": { cutoffHours: 24 * 366, bucketSec: 7 * 24 * 3600 },
  ALL: { cutoffHours: 24 * 400, bucketSec: 7 * 24 * 3600 },
};

// ── Break events ─────────────────────────────────────────────────────────────

/** The market scenario log: one entry per support/resistance the price
 * actually broke, written at the moment it happened, with the rule-based
 * explanation of what that break conventionally means. */
function BreakEventsPanel() {
  const { data: tsr } = useQuery({ queryKey: ["level-events", "TSR20"], queryFn: () => api.getLevelEvents("TSR20"), refetchInterval: 30_000 });
  const { data: eu } = useQuery({
    queryKey: ["level-events", "EURUSD"],
    queryFn: () => api.getLevelEvents("EURUSD"),
    refetchInterval: 30_000,
    enabled: SHOW_EURUSD,
  });
  const events = [...(tsr ?? []), ...(SHOW_EURUSD ? (eu ?? []) : [])]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 20);

  return (
    <div className="bg-bg-raised border border-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <Zap size={12} className="text-accent" />
        <h3 className="kicker text-[11px] text-text-faint">Level Breaks — live scenario log</h3>
      </div>
      <p className="text-[11px] text-text-faint mb-2">
        Written the moment price crosses a computed level; each entry explains the scenario at that time. S/R recomputes after every break.
      </p>
      {events.length === 0 && (
        <p className="text-[11px] text-text-faint py-3 border-t border-border-subtle">
          No breaks logged yet — the log fills as soon as the market takes out a computed level.
        </p>
      )}
      {events.map((e: LevelEventRecord) => {
        const isTSR = e.market_tag === "TSR20";
        const up = e.direction === "break_above";
        return (
          <div key={`${e.market_tag}-${e.id}`} className="py-2.5 border-t border-border-subtle">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("kicker text-[9px] font-semibold", isTSR ? "text-tsr20" : "text-eurusd")}>{e.market_tag}</span>
              <span className={cn("num text-[12px] font-bold", up ? "text-bull" : "text-bear")}>
                {up ? "▲ broke above" : "▼ broke below"} {e.level_label.toLowerCase()} {isTSR ? e.level_price.toFixed(0) : e.level_price.toFixed(4)}
              </span>
              {e.proven && (
                <span className="kicker text-[8px] flex items-center gap-0.5 text-accent border border-accent/40 px-1 py-px">
                  <ShieldCheck size={9} /> was proven ×{e.strength}
                </span>
              )}
              <span className="kicker text-[9px] text-text-faint ml-auto" title={e.ts}>
                {relativeTime(e.ts)}
              </span>
            </div>
            <p className="text-[11px] text-text-dim leading-relaxed mt-1">{e.explanation}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const FX_LABELS: Record<string, string> = {
  EURUSD: "EURUSD",
  GBPUSD: "GBPUSD",
  CNYUSD: "CNYUSD",
  USDIDR: "USDIDR",
  USDCFA: "USDCFA",
};
const FX_DECIMALS: Record<string, number> = { EURUSD: 5, GBPUSD: 5, CNYUSD: 4, USDIDR: 2, USDCFA: 2 };

export default function Prices() {
  const queryClient = useQueryClient();

  // Chart settings auto-save like everything else on the page.
  const [tsrTf, setTsrTf] = useState<string>(() => localStorage.getItem("tsr20-tf") ?? "3M");
  const [tsrStyle, setTsrStyle] = useState<string>(() => localStorage.getItem("tsr20-style") ?? "candles");
  const pickTf = (tf: string) => {
    setTsrTf(tf);
    localStorage.setItem("tsr20-tf", tf);
  };
  const pickStyle = (s: string) => {
    setTsrStyle(s);
    localStorage.setItem("tsr20-style", s);
  };

  // Board and FX strip refetch every 15s; the charts themselves are
  // TradingView embeds and stream on their own.
  const { data: board, isLoading } = useQuery({ queryKey: ["price-board"], queryFn: api.getPriceBoard, refetchInterval: 10_000 });
  const { data: tsrLive } = useQuery({ queryKey: ["ticks", "TSR20_LIVE"], queryFn: () => api.getTicks("TSR20_LIVE", 24), refetchInterval: 30_000 });
  const { data: tsrHistory } = useQuery({ queryKey: ["tsr20-history"], queryFn: () => api.getTsr20History(365), staleTime: 900_000 });
  const { data: tsrLevels } = useQuery({ queryKey: ["levels", "TSR20"], queryFn: () => api.getLevels("TSR20"), refetchInterval: 30_000 });
  const { data: euLevels } = useQuery({
    queryKey: ["levels", "EURUSD"],
    queryFn: () => api.getLevels("EURUSD"),
    refetchInterval: 30_000,
    enabled: SHOW_EURUSD,
  });

  const mutation = useMutation({
    mutationFn: (payload: QuoteUpdate) => api.putQuote(payload),
    onSuccess: () => {
      // A committed edit can move the front month $10+ — everything derived
      // from the board (ticks, proven levels, pivots) recomputes right away.
      queryClient.invalidateQueries({ queryKey: ["price-board"] });
      queryClient.invalidateQueries({ queryKey: ["ticks", "TSR20"] });
      queryClient.invalidateQueries({ queryKey: ["levels", "TSR20"] });
    },
  });

  const sgxSync = useMutation({
    mutationFn: api.refreshSgx,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-board"] });
      queryClient.invalidateQueries({ queryKey: ["ticks", "TSR20"] });
      queryClient.invalidateQueries({ queryKey: ["levels", "TSR20"] });
    },
  });

  const shanghaiSync = useMutation({
    mutationFn: api.refreshShanghai,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price-board"] }),
  });

  const quotes = board?.quotes ?? [];
  const shanghai = board?.shanghai ?? [];
  const fx = board?.fx ?? [];

  const commit = (q: FuturesQuote, field: keyof QuoteUpdate) => (v: number) =>
    mutation.mutate({ market_tag: "TSR20", contract_month: q.contract_month, [field]: v });

  // SGX's own chart series (daily settlements, same data the exchange's
  // product chart plots) with today's live ticks appended on the end,
  // filtered to the chosen timeframe and bucketed into candles on demand.
  const tf = TSR_TIMEFRAMES[tsrTf] ?? TSR_TIMEFRAMES["3M"];
  const cutoff = Date.now() - tf.cutoffHours * 3600_000;
  const tsrSeries = [...(tsrHistory ?? []), ...(tsrLive ?? [])].filter((p) => new Date(p.ts).getTime() >= cutoff);
  const tsrCandles = tsrStyle === "candles" ? toCandles(tsrSeries, tf.bucketSec) : undefined;

  if (isLoading) return <FeedSkeleton rows={8} />;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="headline text-2xl font-bold text-text">Price Desk</h2>
          <p className="text-[12px] text-text-faint mt-0.5">
            SGX TSR20 — live, applied on every poll · real-time FX · rule-based support &amp; resistance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end gap-1">
            <span className="kicker text-[10px] text-text-faint flex items-center gap-1.5 flex-wrap justify-end">
              {board?.sgx_synced_at && (
                <>
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="pulse-ring absolute inline-flex h-1.5 w-1.5 text-tsr20" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-tsr20" />
                  </span>
                  SGX delayed ~10-15 min
                  {board.sgx_price_as_of &&
                    ` · Price as of ${new Date(board.sgx_price_as_of).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST`}{" "}
                  · Fetched{" "}
                  {new Date(board.sgx_synced_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })}{" "}
                  IST
                </>
              )}
              <button
                onClick={() => sgxSync.mutate()}
                disabled={sgxSync.isPending}
                className="kicker text-[10px] text-accent hover:opacity-80 disabled:opacity-50 active:scale-[0.97] transition-[opacity,transform] duration-300"
              >
                {sgxSync.isPending ? "Syncing…" : "Sync now"}
              </button>
            </span>
            <span className="kicker text-[10px] text-text-faint flex items-center gap-1.5 flex-wrap justify-end">
              {board?.shanghai_synced_at && (
                <>
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="pulse-ring absolute inline-flex h-1.5 w-1.5 text-tsr20" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-tsr20" />
                  </span>
                  Shanghai real-time (Sina feed) · Fetched{" "}
                  {new Date(board.shanghai_synced_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })}{" "}
                  IST
                </>
              )}
              <button
                onClick={() => shanghaiSync.mutate()}
                disabled={shanghaiSync.isPending}
                className="kicker text-[10px] text-accent hover:opacity-80 disabled:opacity-50 active:scale-[0.97] transition-[opacity,transform] duration-300"
              >
                {shanghaiSync.isPending ? "Syncing…" : "Sync now"}
              </button>
            </span>
          </div>
        </div>
      </div>

      {/* ── The board first — the desk sheet's tables and FX block ─────── */}
      <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4 items-stretch">
        <div className="bg-bg-raised border border-border p-4 overflow-x-auto">
          <h3 className="kicker text-[11px] text-tsr20 mb-2">TSR20 Futures · SGX SICOM</h3>
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                {["Month", "Current Market price (T)", "Change (ΔT)", "Open (O)", "High (H)", "Low (Lo)", "Volume (Vcon)", "Closing Price (L.S)"].map((h) => (
                  <th key={h} className="kicker text-[9px] text-text-faint text-right first:text-left font-normal px-1.5 pb-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.contract_month} className="border-b border-border-subtle last:border-0">
                  <td className="text-[12px] font-medium text-text py-1.5 px-1.5">{q.contract_month}</td>
                  <td className="w-24"><EditCell value={q.price} onCommit={commit(q, "price")} /></td>
                  <td className="text-right px-1.5"><DerivedCell value={q.change} signed /></td>
                  <td className="w-20"><EditCell value={q.open} onCommit={commit(q, "open")} /></td>
                  <td className="w-20"><EditCell value={q.high} onCommit={commit(q, "high")} /></td>
                  <td className="w-20"><EditCell value={q.low} onCommit={commit(q, "low")} /></td>
                  <td className="w-20"><EditCell value={q.volume} onCommit={commit(q, "volume")} /></td>
                  <td className="w-24"><EditCell value={q.close} onCommit={commit(q, "close")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-bg-raised border border-border p-4 overflow-x-auto">
          <h3 className="kicker text-[11px] text-tsr20 mb-2">Open Interest</h3>
          <table className="w-full min-w-[420px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                {["Month", "Open Interest", "Change in OI", "% change in price", "Prev OI"].map((h) => (
                  <th key={h} className="kicker text-[9px] text-text-faint text-right first:text-left font-normal px-1.5 pb-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.contract_month} className="border-b border-border-subtle last:border-0">
                  <td className="text-[12px] font-medium text-text py-1.5 px-1.5">{q.contract_month}</td>
                  <td className="w-24"><EditCell value={q.open_interest} onCommit={commit(q, "open_interest")} /></td>
                  <td className="w-24"><EditCell value={q.oi_change} onCommit={commit(q, "oi_change")} /></td>
                  <td className="text-right px-1.5"><DerivedCell value={q.price_change_pct} suffix="%" /></td>
                  <td className="text-right px-1.5"><DerivedCell value={q.prev_open_interest} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="kicker text-[9px] text-text-faint">
        SGX SICOM sessions (IST): session open 05:25 · session close 15:30, then T+1 session 15:45–20:30 · (Singapore time 07:55–18:00 &amp; 18:15–23:00)
      </p>

      {/* FX strip lives with the board — real-time Google Finance spot
          (Yahoo fallback), 1-min server pull, 15s page refresh. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-border border border-border">
        {fx.map((r) => {
          const up = (r.change_pct ?? 0) > 0;
          const down = (r.change_pct ?? 0) < 0;
          return (
            <div key={r.pair} className="bg-bg-raised p-3">
              <p className="kicker text-[9px] text-eurusd">{FX_LABELS[r.pair] ?? r.pair}</p>
              <p className="num text-base font-bold text-text mt-1">{r.rate.toFixed(FX_DECIMALS[r.pair] ?? 4)}</p>
              <p className={cn("num text-[10px] flex items-center gap-0.5 mt-0.5", up ? "text-bull" : down ? "text-bear" : "text-text-faint")}>
                {up ? <ArrowUpRight size={10} /> : down ? <ArrowDownRight size={10} /> : null}
                {r.change_pct !== null ? `${up ? "+" : ""}${r.change_pct}%` : "—"}
                {r.fetched_at && <span className="kicker text-[8px] text-text-faint ml-1">{relativeTime(r.fetched_at)}</span>}
              </p>
            </div>
          );
        })}
        {fx.length === 0 && (
          <div className="bg-bg-raised p-3 col-span-full">
            <p className="text-[11px] text-text-faint">FX rates load on the next scheduler pass (every minute).</p>
          </div>
        )}
      </div>

      {/* Shanghai TSR20 — the INE "NR" contract, same board format as SGX.
          Prices in CNY/tonne straight from the exchange feed via Sina. */}
      {shanghai.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4 items-stretch">
          <div className="bg-bg-raised border border-border p-4 overflow-x-auto">
            <h3 className="kicker text-[11px] text-tsr20 mb-2">Shanghai TSR20 · INE NR (CNY/tonne)</h3>
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {["Month", "Current Market price (T)", "Change (ΔT)", "Open (O)", "High (H)", "Low (Lo)", "Volume (Vcon)", "Closing Price (L.S)"].map((h) => (
                    <th key={h} className="kicker text-[9px] text-text-faint text-right first:text-left font-normal px-1.5 pb-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shanghai.map((q) => (
                  <tr key={q.contract_month} className="border-b border-border-subtle last:border-0">
                    <td className="text-[12px] font-medium text-text py-1.5 px-1.5">{q.contract_month}</td>
                    <td className="num text-[12px] text-text text-right px-1.5">{q.price.toLocaleString("en-IN")}</td>
                    <td className="text-right px-1.5"><DerivedCell value={q.change} signed /></td>
                    <td className="num text-[12px] text-text-dim text-right px-1.5">{q.open.toLocaleString("en-IN")}</td>
                    <td className="num text-[12px] text-text-dim text-right px-1.5">{q.high.toLocaleString("en-IN")}</td>
                    <td className="num text-[12px] text-text-dim text-right px-1.5">{q.low.toLocaleString("en-IN")}</td>
                    <td className="num text-[12px] text-text-dim text-right px-1.5">{q.volume.toLocaleString("en-IN")}</td>
                    <td className="num text-[12px] text-text text-right px-1.5">{q.close.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-bg-raised border border-border p-4 overflow-x-auto">
            <h3 className="kicker text-[11px] text-tsr20 mb-2">Open Interest · Shanghai</h3>
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {["Month", "Open Interest", "Change in OI", "% change in price", "Prev OI"].map((h) => (
                    <th key={h} className="kicker text-[9px] text-text-faint text-right first:text-left font-normal px-1.5 pb-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shanghai.map((q) => (
                  <tr key={q.contract_month} className="border-b border-border-subtle last:border-0">
                    <td className="text-[12px] font-medium text-text py-1.5 px-1.5">{q.contract_month}</td>
                    <td className="num text-[12px] text-text text-right px-1.5">{q.open_interest.toLocaleString("en-IN")}</td>
                    <td className="text-right px-1.5"><DerivedCell value={q.oi_change} signed /></td>
                    <td className="text-right px-1.5"><DerivedCell value={q.price_change_pct} suffix="%" /></td>
                    <td className="num text-[12px] text-text-dim text-right px-1.5">{q.prev_open_interest.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {shanghai.length > 0 && (
        <p className="kicker text-[9px] text-text-faint">
          INE NR sessions (IST): day session open 06:30 · close 12:30 — night session open 18:30 · close 20:30 · (China time 09:00–15:00 &amp; 21:00–23:00)
        </p>
      )}

      </div>

      {/* ── Charts + S/R — full-width, one under the other, so each chart
             gets the whole row instead of half a column ────────────────── */}
      <div className="grid grid-cols-1 gap-4 items-start">
        <div className="bg-bg-raised border border-border p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="kicker text-[11px] text-tsr20">TSR20 · SGX chart</h3>
            <div className="flex items-center gap-1 flex-wrap">
              {Object.keys(TSR_TIMEFRAMES).map((k) => (
                <button
                  key={k}
                  onClick={() => pickTf(k)}
                  className={cn(
                    "kicker text-[10px] px-2 py-1 border transition-colors",
                    tsrTf === k ? "border-tsr20 text-tsr20 bg-tsr20-dim" : "border-border-subtle text-text-faint hover:text-text"
                  )}
                >
                  {k}
                </button>
              ))}
              <span className="w-2" />
              {(["candles", "line"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => pickStyle(s)}
                  className={cn(
                    "kicker text-[10px] px-2 py-1 border transition-colors capitalize",
                    tsrStyle === s ? "border-tsr20 text-tsr20 bg-tsr20-dim" : "border-border-subtle text-text-faint hover:text-text"
                  )}
                >
                  {s}
                </button>
              ))}
              {tsrLevels?.current_price != null && <span className="num text-sm font-bold text-text ml-2">{tsrLevels.current_price.toFixed(0)}</span>}
            </div>
          </div>
          {/* storageKey carries the timeframe so each view keeps its own
              saved zoom (and stale ranges from other frames never apply). */}
          <LWChart
            candles={tsrCandles}
            line={tsrCandles ? undefined : tsrSeries}
            levels={tsrLevels?.levels ?? []}
            decimals={0}
            storageKey={`tsr20-chart-range-v2-${tsrTf}-${tsrStyle}`}
          />
          <p className="kicker text-[8px] text-text-faint mt-1.5">
            SGX settlement history + live ticks. Intraday candles carry real observed ranges; daily candles show settlement-to-settlement bodies (SGX publishes no historical daily H/L).
          </p>
          <div className="mt-4 pt-3 border-t border-border-subtle">
            <LevelsPanel market="TSR20" decimals={0} />
          </div>
        </div>

        {SHOW_EURUSD && (
          <div className="bg-bg-raised border border-border p-4">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="kicker text-[11px] text-eurusd">EUR/USD · today, live</h3>
              {euLevels?.current_price != null && <span className="num text-sm font-bold text-text">{euLevels.current_price.toFixed(5)}</span>}
            </div>
            <TradingViewChart symbol="FX:EURUSD" interval="15" />
            <div className="mt-4 pt-3 border-t border-border-subtle">
              <LevelsPanel market="EURUSD" decimals={4} />
            </div>
          </div>
        )}
      </div>

      {/* ── Break log — every S/R the market actually took out ─────────── */}
      <BreakEventsPanel />
    </div>
  );
}
