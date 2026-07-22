import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useReveal } from "@/lib/hooks";
import { AnimatedHeadline } from "@/components/AnimatedHeadline";
import { TradeRaceChart } from "@/components/TradeRaceChart";
import { GradeChart } from "@/components/GradeChart";
import { FeedRow } from "@/components/FeedRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FeedSkeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import type { TradeMoverRow } from "@/lib/types";

function formatUSD(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${(value / 1e3).toFixed(0)}K`;
}

function formatEUR(value: number): string {
  if (value >= 1e9) return `€${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `€${(value / 1e6).toFixed(1)}M`;
  return `€${(value / 1e3).toFixed(0)}K`;
}

function formatMonth(period: string): string {
  if (period.length !== 6) return period;
  const m = Number(period.slice(4, 6));
  const name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
  return `${name} ${period.slice(0, 4)}`;
}

function formatTonnes(kg: number): string {
  const t = kg / 1000;
  if (t >= 1e6) return `${(t / 1e6).toFixed(2)}M t`;
  if (t >= 1e3) return `${(t / 1e3).toFixed(0)}k t`;
  return `${t.toFixed(0)} t`;
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="num text-[11px] text-text-faint">—</span>;
  const up = pct > 0;
  return (
    <span className={cn("num text-[11px] flex items-center gap-1 justify-end", up ? "text-bull" : pct < 0 ? "text-bear" : "text-text-faint")}>
      {up ? <TrendingUp size={11} /> : pct < 0 ? <TrendingDown size={11} /> : null}
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}

function MoversTable({
  title,
  subtitle,
  rows,
  accent,
}: {
  title: string;
  subtitle: string;
  rows: TradeMoverRow[];
  accent: "tsr20" | "eurusd";
}) {
  const ref = useReveal();
  return (
    <div ref={ref} className="reveal">
      <h3 className={cn("kicker text-[11px] mb-1", accent === "tsr20" ? "text-tsr20" : "text-eurusd")}>{title}</h3>
      <p className="text-xs text-text-faint mb-3">{subtitle}</p>
      <div>
        {rows.slice(0, 10).map((row) => (
          <div
            key={row.country}
            className="flex items-baseline justify-between gap-3 py-2 border-b border-border-subtle last:border-0"
          >
            <span className="text-[13px] text-text truncate">{row.country}</span>
            <div className="flex items-baseline gap-4 shrink-0">
              <span className="num text-[11px] text-text-faint w-16 text-right">{formatTonnes(row.qty_kg)}</span>
              <span className="num text-[12px] text-text-dim w-20 text-right">{formatUSD(row.value_usd)}</span>
              <span className="w-16 text-right">
                <Delta pct={row.change_pct} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TradeFlow() {
  // Yearly by default: monthly customs filings are sparse for every grade
  // except TSR, so a monthly-first page showed one lonely chart where four
  // belong. Monthly stays one click away.
  const [freq, setFreq] = useState<"A" | "M">("A");
  const chartRef = useReveal();
  const flowsRef = useReveal();
  const newsRef = useReveal();

  const { data: balance } = useQuery({ queryKey: ["trade-balance"], queryFn: api.getTradeBalance, refetchInterval: 300_000 });
  const { data: supply } = useQuery({ queryKey: ["trade-supply"], queryFn: () => api.getTradeSupply("A"), refetchInterval: 300_000 });
  const { data: demand } = useQuery({ queryKey: ["trade-demand"], queryFn: () => api.getTradeDemand("A"), refetchInterval: 300_000 });
  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: ["trade-timeline", freq],
    queryFn: () => api.getTradeTimeline(freq),
    refetchInterval: 300_000,
  });
  const { data: flows } = useQuery({ queryKey: ["trade-flows"], queryFn: api.getTradeFlows, refetchInterval: 300_000 });

  // TSR20 only — this page is the rubber trade desk. EUR/USD trade news has
  // its own wall and must never appear here.
  const { data: news, isLoading: newsLoading } = useQuery({
    queryKey: ["news-history", "TSR20", "trade"],
    queryFn: () => api.getNewsHistory("TSR20", { limit: 30, category: "trade" }),
    refetchInterval: 60_000,
  });
  const { data: grades } = useQuery({
    queryKey: ["trade-grades", freq],
    queryFn: () => api.getTradeGrades(freq),
    refetchInterval: 300_000,
  });
  const { data: fresh } = useQuery({
    queryKey: ["trade-freshness"],
    queryFn: api.getTradeFreshness,
    refetchInterval: 300_000,
  });
  const { data: eu } = useQuery({
    queryKey: ["eu-imports"],
    queryFn: api.getEUImports,
    refetchInterval: 300_000,
  });

  const hasTradeData = (timeline?.frames.length ?? 0) > 0;

  return (
    <div className="max-w-6xl mx-auto space-y-12">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-tsr20 mb-3">Analysis · TSR20 Natural Rubber Only</p>
        <AnimatedHeadline text="Trade, Supply &amp; Demand" className="text-4xl md:text-5xl font-bold text-text" />
        <p className="text-sm text-text-dim mt-3 max-w-2xl mx-auto rise-in" style={{ animationDelay: "250ms" }}>
          Official customs filings for HS 4001 natural rubber, from the UN Comtrade database — every figure is a
          government declaration, not an estimate. Exports read as supply, imports as demand.
        </p>
      </header>

      {balance && (balance.supply_period || balance.demand_period) && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="border border-border-subtle p-5">
            <p className="kicker text-[10px] text-tsr20 mb-2">Supply · {balance.supply_period}</p>
            <p className="num text-3xl font-bold text-text">{formatUSD(balance.supply_total_usd)}</p>
            <div className="flex items-center gap-2 mt-1">
              <Delta pct={balance.supply_change_pct} />
              <span className="text-[11px] text-text-faint">vs {balance.supply_prior_period}</span>
            </div>
            <p className="text-xs text-text-faint mt-3 leading-relaxed">
              Exports declared by {balance.supply_country_count} producing countries.
              {balance.rising_supply.length > 0 && (
                <>
                  {" "}
                  Rising: <span className="text-tsr20">{balance.rising_supply.join(", ")}</span>.
                </>
              )}
            </p>
          </div>

          <div className="border border-border-subtle p-5">
            <p className="kicker text-[10px] text-eurusd mb-2">Demand · {balance.demand_period}</p>
            <p className="num text-3xl font-bold text-text">{formatUSD(balance.demand_total_usd)}</p>
            <div className="flex items-center gap-2 mt-1">
              <Delta pct={balance.demand_change_pct} />
              <span className="text-[11px] text-text-faint">vs {balance.demand_prior_period}</span>
            </div>
            <p className="text-xs text-text-faint mt-3 leading-relaxed">
              Imports declared by {balance.demand_country_count} consuming countries.
              {balance.rising_demand.length > 0 && (
                <>
                  {" "}
                  Rising: <span className="text-eurusd">{balance.rising_demand.join(", ")}</span>.
                </>
              )}
            </p>
          </div>
        </section>
      )}

      {grades && grades.length > 0 && (
        <section className="border-t border-rule pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
            <h2 className="kicker text-[11px] text-text-faint">Production by Grade — Exports</h2>
            <span className="kicker text-[9px] text-text-faint">{freq === "M" ? "Monthly" : "Yearly"}</span>
          </div>
          <p className="text-xs text-text-faint mb-5 max-w-3xl">
            Each rubber grade files under its own HS subheading, so these are separate measurements — not slices of one
            number. <span className="text-tsr20">TSR/TSNR is the grade TSR20 belongs to.</span> Cup lumps have no
            dedicated HS line: they are upstream field material, mostly processed domestically into TSR rather than
            exported, so HS 400129 captures only the share that crosses a border.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {grades.map((g) => (
              <GradeChart key={g.hs_code} series={g} />
            ))}
          </div>
        </section>
      )}

      {eu && eu.rows.length > 0 && eu.latest_period && (
        <section className="border-t border-rule pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
            <h2 className="kicker text-[11px] text-eurusd">EU Imports by Source Country — Eurostat</h2>
            <span className="kicker text-[9px] text-text-faint">
              {formatMonth(eu.latest_period)} · EUR
            </span>
          </div>
          <p className="text-xs text-text-faint mb-5 max-w-3xl">
            Europe's own customs declarations, published monthly with about a five-month lag — the freshest official
            trade data available anywhere for this commodity, and far more current than the Comtrade figures above.
            Values are in <span className="text-text-dim">euros</span> and cover the EU27 only, so they are shown
            separately rather than added to the dollar totals.
          </p>
          <div>
            {eu.rows.slice(0, 12).map((r) => (
              <div
                key={r.country}
                className="flex items-baseline justify-between gap-3 py-2 border-b border-border-subtle last:border-0"
              >
                <span className="text-[13px] text-text truncate">{r.country}</span>
                <div className="flex items-baseline gap-4 shrink-0">
                  <span className="num text-[11px] text-text-faint w-16 text-right">{formatTonnes(r.qty_kg)}</span>
                  <span className="num text-[12px] text-text-dim w-20 text-right">{formatEUR(r.value_eur)}</span>
                  <span className="w-16 text-right">
                    <Delta pct={r.change_pct} />
                  </span>
                </div>
              </div>
            ))}
          </div>
          {eu.prior_period && (
            <p className="kicker text-[9px] text-text-faint mt-3">
              Change vs {formatMonth(eu.prior_period)} · HS 4001 grades combined
            </p>
          )}
        </section>
      )}

      {fresh && fresh.length > 0 && (
        <section className="border-t border-rule pt-8">
          <h2 className="kicker text-[11px] text-text-faint mb-1">Data Freshness</h2>
          <p className="text-xs text-text-faint mb-4 max-w-3xl">
            Governments file customs data with a long lag — typically one to two years before a year is fully reported.
            "Complete" means enough countries filed to rank and total honestly; "latest filed" is the newest record of
            any kind, however thin. Rankings on this page use complete periods only.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {fresh.map((f) => (
              <div key={f.hs_code} className="border border-border-subtle p-3">
                <p className="kicker text-[9px] text-text-dim truncate">{f.grade}</p>
                <p className="num text-[12px] text-text mt-2">
                  Complete: <span className="text-tsr20">{f.latest_complete_year ?? "—"}</span>
                </p>
                <p className="num text-[11px] text-text-faint mt-0.5">
                  Latest filed: {f.latest_filed_year ?? "—"}
                  {f.latest_filed_year_reporters > 0 && ` (${f.latest_filed_year_reporters} countries)`}
                </p>
                {f.latest_filed_month && (
                  <p className="num text-[11px] text-text-faint">Monthly to: {f.latest_filed_month}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section ref={chartRef} className="reveal border-t border-rule pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
          <h2 className="kicker text-[11px] text-text-faint">Import / Export by Country — Animated</h2>
          <div className="inline-flex items-center gap-1">
            {(["M", "A"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFreq(f)}
                className={cn(
                  "kicker text-[10px] px-2 py-0.5 border transition-colors duration-300",
                  freq === f ? "border-accent/40 text-accent bg-accent/10" : "border-border-subtle text-text-faint hover:text-text-dim"
                )}
              >
                {f === "M" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-text-faint mb-2 max-w-3xl">
          Press play to watch volumes and rankings move across {freq === "M" ? "months" : "years"} of customs data.
          <span className="text-text-dim"> Supply lists producing countries; Demand lists consuming countries</span> —
          they are different sets, so the bars change entirely when you switch.
        </p>
        <p className="text-xs text-text-faint mb-5 max-w-3xl">
          This chart stops at the newest year enough countries have fully filed with the UN — currently{" "}
          <span className="text-accent">
            {timeline?.frames.length ? timeline.frames[timeline.frames.length - 1].period : "—"}
          </span>
          . That is not stale data or an error: national customs offices report to the UN one to two years in arrears.
          For current months, see the Eurostat panel above, which runs to {eu?.latest_period ? formatMonth(eu.latest_period) : "recent months"}.
        </p>

        {timelineLoading && <EmptyState loading title="Loading customs data…" />}
        {!timelineLoading && !hasTradeData && (
          <EmptyState
            title="Trade data still loading"
            description="The first UN Comtrade pull takes a couple of minutes and runs automatically on startup. It refreshes every 12 hours after that."
          />
        )}
        {hasTradeData && timeline && <TradeRaceChart frames={timeline.frames} />}
      </section>

      {supply && demand && supply.rows.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-10 border-t border-rule pt-8">
          <MoversTable
            title="Supply — Top Exporters"
            subtitle={`Latest complete year ${supply.latest_period ?? ""} vs ${supply.prior_period ?? ""}`}
            rows={supply.rows}
            accent="tsr20"
          />
          <MoversTable
            title="Demand — Top Importers"
            subtitle={`Latest complete year ${demand.latest_period ?? ""} vs ${demand.prior_period ?? ""}`}
            rows={demand.rows}
            accent="eurusd"
          />
        </section>
      )}

      {flows && flows.length > 0 && (
        <section ref={flowsRef} className="reveal border-t border-rule pt-8">
          <h2 className="kicker text-[11px] text-text-faint mb-1">Where the Rubber Actually Goes</h2>
          <p className="text-xs text-text-faint mb-4">
            Largest bilateral lanes in {flows[0].period} — exporter to importer, by declared value.
          </p>
          <div>
            {flows.slice(0, 15).map((f, i) => (
              <div
                key={`${f.exporter}-${f.importer}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2 border-b border-border-subtle last:border-0"
              >
                <span className="text-[13px] text-text flex items-center gap-2 min-w-0">
                  <span className="text-tsr20 truncate">{f.exporter}</span>
                  <ArrowRight size={11} className="text-text-faint shrink-0" />
                  <span className="text-eurusd truncate">{f.importer}</span>
                </span>
                <span className="flex items-baseline gap-4 shrink-0">
                  <span className="num text-[11px] text-text-faint">{formatTonnes(f.qty_kg)}</span>
                  <span className="num text-[12px] text-text-dim w-20 text-right">{formatUSD(f.value_usd)}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section ref={newsRef} className="reveal border-t border-rule pt-8">
        <h2 className="kicker text-[11px] text-text-faint mb-1">Rubber Trade &amp; Export Wire</h2>
        <p className="text-xs text-text-faint mb-3">
          TSR20 only — official bulletins, customs releases, and buyer-side coverage.
        </p>
        {newsLoading && <FeedSkeleton rows={5} />}
        {!newsLoading && (news?.length ?? 0) === 0 && (
          <EmptyState title="No trade news yet" description="The desk scrapes ANRPC / GAPKINDO / customs coverage continuously." />
        )}
        {news && news.length > 0 && (
          <div>
            {news.map((item) => (
              <FeedRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
