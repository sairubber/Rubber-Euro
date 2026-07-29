import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeskLineChart } from "@/components/DeskLineChart";
import { cn } from "@/lib/utils";

/** Warrant Stocks — INE NR (TSR20) on-warrant warehouse inventory, daily,
 * in tonnes. Falling warrants = physical leaving exchange warehouses =
 * nearby tightness; building warrants = deliverable surplus. */

export default function WarrantStocks() {
  const { data, isLoading } = useQuery({
    queryKey: ["warrant-stocks"],
    queryFn: () => api.getWarrantStocks(240),
    refetchInterval: 3_600_000, refetchIntervalInBackground: true,
  });

  if (isLoading) return <EmptyState loading title="Loading warrant stocks…" />;
  if (!data || data.series.length === 0)
    return <EmptyState title="No stock data" description="The exchange mirror hasn't answered yet — check back shortly." />;

  const s = data.series;
  const latest = s[s.length - 1];
  const prev = s[s.length - 2];
  const monthAgo = s[Math.max(s.length - 21, 0)];
  const monthChange = latest.tonnes - monthAgo.tonnes;
  const peak = s.reduce((a, b) => (b.tonnes > a.tonnes ? b : a));
  const trough = s.reduce((a, b) => (b.tonnes < a.tonnes ? b : a));

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Inventory</p>
        <h1 className="headline text-4xl font-bold text-text">Warrant Stocks</h1>
        <p className="text-sm text-text-dim mt-2">
          {data.contract} — tonnes of TSR20 sitting on warrant in exchange warehouses, updated daily. Falling warrants
          mean physical is leaving the delivery system; building warrants mean deliverable surplus.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-border-subtle bg-surface p-4">
          <p className="kicker text-[10px] text-text-faint mb-1">On warrant · {latest.date}</p>
          <p className="num text-2xl font-bold text-text">{latest.tonnes.toLocaleString()}<span className="text-xs font-normal text-text-faint ml-1">t</span></p>
        </div>
        <div className="border border-border-subtle bg-surface p-4">
          <p className="kicker text-[10px] text-text-faint mb-1">Daily change</p>
          <p className={cn("num text-2xl font-bold", latest.change < 0 ? "text-bull" : latest.change > 0 ? "text-bear" : "text-text")}>
            {latest.change > 0 ? "+" : ""}{latest.change.toLocaleString()}<span className="text-xs font-normal text-text-faint ml-1">t</span>
          </p>
          {prev && <p className="kicker text-[9px] text-text-faint mt-1">prev day {prev.change > 0 ? "+" : ""}{prev.change.toLocaleString()} t</p>}
        </div>
        <div className="border border-border-subtle bg-surface p-4">
          <p className="kicker text-[10px] text-text-faint mb-1">~1 month change</p>
          <p className={cn("num text-2xl font-bold", monthChange < 0 ? "text-bull" : monthChange > 0 ? "text-bear" : "text-text")}>
            {monthChange > 0 ? "+" : ""}{monthChange.toLocaleString()}<span className="text-xs font-normal text-text-faint ml-1">t</span>
          </p>
          <p className="kicker text-[9px] text-text-faint mt-1">since {monthAgo.date}</p>
        </div>
        <div className="border border-border-subtle bg-surface p-4">
          <p className="kicker text-[10px] text-text-faint mb-1">Window range</p>
          <p className="num text-sm text-text mt-1">{trough.tonnes.toLocaleString()} – {peak.tonnes.toLocaleString()} t</p>
          <p className="kicker text-[9px] text-text-faint mt-1">low {trough.date} · high {peak.date}</p>
        </div>
      </div>

      <div className="border border-border-subtle bg-surface p-5">
        <p className="kicker text-[10px] text-text-faint mb-4">On-warrant stock — tonnes, daily</p>
        <DeskLineChart
          series={[{ key: "nr", label: "INE NR warrants (t)", color: "#2f6b4f", points: s.map((p) => ({ x: p.date.slice(5), y: p.tonnes })) }]}
          height={220}
        />
      </div>

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Source:</span>
        {data.source}. These are the exchange's own daily on-warrant figures for the INE 20号胶 (NR/TSR20) contract; the
        exchange websites block datacenter traffic, so the desk reads East Money's public mirror of the same numbers.
        Daily-change colour reads supply-side: draws (red exchange number, green here) tighten nearby supply, builds
        loosen it. SHFE's RU contract is whole-latex/RSS-based and is deliberately not shown — the desk trades TSR20
        only. Qingdao bonded-warehouse stocks (the bigger off-exchange pool) are paid data (Mysteel) and are not shown
        rather than estimated.
      </div>
    </div>
  );
}
