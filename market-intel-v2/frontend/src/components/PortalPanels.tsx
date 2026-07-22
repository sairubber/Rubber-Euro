import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Play, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { NewsArticleRecord, NewsCategory } from "@/lib/types";

/** The four utility panels that sit under the front-page mosaic.
 *
 * Every panel is driven by real stored data — country mention counts,
 * category counts, and the rule-based region signals. The reference layout
 * had a reader poll in the fourth slot; that is fabricated engagement on a
 * research site with no accounts and no vote storage, so the slot carries
 * live supply-risk instead, which is the thing this desk actually publishes.
 */

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-bg-raised border border-border flex flex-col min-w-0">
      <header className="flex items-baseline justify-between gap-2 px-4 pt-4 pb-3 border-b border-border">
        <h2 className="headline text-lg font-bold text-text">{title}</h2>
        {action}
      </header>
      <div className="p-4 flex-1 flex flex-col">{children}</div>
    </section>
  );
}

/** Countries appearing most across current TSR20 coverage. */
export function TrendingCountriesPanel() {
  const { data } = useQuery({
    queryKey: ["country-breakdown", "TSR20", "all"],
    queryFn: () => api.getCountryBreakdown("TSR20", "trade"),
    refetchInterval: 300_000,
  });

  const rows = (data ?? []).filter((r) => r.country !== "Unspecified").slice(0, 8);

  return (
    <Panel title="Trending Countries">
      {rows.length === 0 ? (
        <p className="text-xs text-text-faint">No country-tagged coverage yet.</p>
      ) : (
        <ul className="space-y-0">
          {rows.map((r) => (
            <li
              key={r.country}
              className="flex items-center gap-2.5 py-2 border-b border-border-subtle last:border-0"
            >
              <TrendingUp size={13} className="text-tsr20 shrink-0" />
              <span className="text-[13px] text-text truncate flex-1">{r.country}</span>
              <span className="num text-[11px] text-text-faint shrink-0">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="kicker text-[8px] text-text-faint mt-3">
        Mentions across stored rubber trade coverage
      </p>
    </Panel>
  );
}

/** The ambient desk video, given a real home rather than only sitting
 * behind the hero. */
export function VideoPanel() {
  return (
    <Panel title="Desk Video">
      <div className="relative border border-border overflow-hidden group">
        <video
          src="/hero.mp4"
          muted
          loop
          playsInline
          autoPlay
          className="w-full h-40 object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-11 h-11 rounded-full bg-accent/90 flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
            <Play size={16} className="text-white ml-0.5" fill="currentColor" />
          </span>
        </span>
      </div>
      <p className="text-[13px] text-text leading-snug mt-3 font-medium">
        Market intelligence desk — live scraping across two markets
      </p>
      <p className="kicker text-[9px] text-text-faint mt-2">Ambient loop · no audio</p>
    </Panel>
  );
}

const CATEGORY_ROWS: { key: NewsCategory | "all"; label: string; market: "TSR20" | "EURUSD" }[] = [
  { key: "headline", label: "TSR20 Headlines", market: "TSR20" },
  { key: "trade", label: "TSR20 Trade", market: "TSR20" },
  { key: "disruption", label: "TSR20 Disruption", market: "TSR20" },
  { key: "headline", label: "EUR/USD Headlines", market: "EURUSD" },
  { key: "trade", label: "EUR/USD Policy", market: "EURUSD" },
];

/** Real counts per category, straight from the stored feed. */
export function CategoriesPanel({ feed }: { feed: NewsArticleRecord[] }) {
  const counts = CATEGORY_ROWS.map((row) => ({
    ...row,
    count: feed.filter((a) => a.market_tag === row.market && a.category === row.key).length,
  })).sort((a, b) => b.count - a.count);

  return (
    <Panel title="Top Categories">
      <ul className="space-y-2">
        {counts.map((row) => {
          const isTSR = row.market === "TSR20";
          return (
            <li key={`${row.market}-${row.key}`}>
              <a
                href={isTSR ? "/wall/tsr20" : "/wall/eurusd"}
                className={cn(
                  "group flex items-center gap-2 px-3 py-2 border transition-colors duration-300",
                  isTSR
                    ? "bg-tsr20-dim border-tsr20/25 hover:border-tsr20"
                    : "bg-eurusd-dim border-eurusd/25 hover:border-eurusd"
                )}
              >
                <span className={cn("text-[12px] font-medium truncate flex-1", isTSR ? "text-tsr20" : "text-eurusd")}>
                  {row.label} <span className="num opacity-70">({row.count})</span>
                </span>
                <ArrowRight
                  size={13}
                  className={cn(
                    "shrink-0 transition-transform duration-300 group-hover:translate-x-0.5",
                    isTSR ? "text-tsr20" : "text-eurusd"
                  )}
                />
              </a>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const RISK_TONE: Record<string, string> = {
  Low: "text-bull border-bull/30 bg-bull-dim",
  Moderate: "text-amber border-amber/30 bg-amber-dim",
  Elevated: "text-bear border-bear/30 bg-bear-dim",
  High: "text-bear border-bear/50 bg-bear-dim",
};

/** Live supply-risk by producing region — the honest replacement for the
 * reference layout's reader poll. */
export function SupplyRiskPanel() {
  const { data: signals } = useQuery({
    queryKey: ["signals-regions"],
    queryFn: api.getRegionSignals,
    refetchInterval: 300_000,
  });
  const { data: outlook } = useQuery({
    queryKey: ["outlook"],
    queryFn: api.getMarketOutlook,
    refetchInterval: 300_000,
  });

  const rows = (signals ?? []).slice().sort((a, b) => b.composite_score - a.composite_score).slice(0, 5);

  return (
    <Panel title="Supply Risk">
      {outlook && <p className="text-[13px] text-text font-medium leading-snug mb-3">{outlook.headline}</p>}
      {rows.length === 0 ? (
        <p className="text-xs text-text-faint">Climate signals still loading.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((s) => (
            <li
              key={s.region}
              className={cn("flex items-center gap-2 px-3 py-2 border", RISK_TONE[s.risk_level] ?? "border-border")}
            >
              <span className="text-[12px] text-text truncate flex-1">{s.region}</span>
              <span className="kicker text-[9px] shrink-0">{s.risk_level}</span>
            </li>
          ))}
        </ul>
      )}
      <a
        href="/analysis/climate"
        className="mt-auto pt-3 kicker text-[9px] text-accent hover:opacity-80 transition-opacity inline-flex items-center gap-1"
      >
        Open Climate Watch <ArrowRight size={10} />
      </a>
    </Panel>
  );
}
