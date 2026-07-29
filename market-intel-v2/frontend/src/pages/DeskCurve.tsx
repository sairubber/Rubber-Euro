import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeskLineChart } from "@/components/DeskLineChart";
import { cn } from "@/lib/utils";
import type { FuturesQuote } from "@/lib/types";

/** Forward Curve — the delivery months the boards already hold, drawn as a
 * curve. Contango (later months dearer) vs backwardation (front dearest) is
 * the desk's roll-cost compass. No new data: this reads the same board the
 * Prices tab shows. */

function curveShape(quotes: FuturesQuote[]): "Contango" | "Backwardation" | "Flat" {
  if (quotes.length < 2) return "Flat";
  const diff = quotes[quotes.length - 1].price - quotes[0].price;
  if (Math.abs(diff) < 1) return "Flat";
  return diff > 0 ? "Contango" : "Backwardation";
}

function CurvePanel({ title, unit, quotes, note }: { title: string; unit: string; quotes: FuturesQuote[]; note: string }) {
  if (quotes.length === 0) return null;
  const shape = curveShape(quotes);
  const series = [
    {
      key: "curve",
      label: `${title} (${unit})`,
      color: "#2f6b4f",
      points: quotes.map((q) => ({ x: q.contract_month.slice(0, 3), y: q.price })),
    },
  ];

  return (
    <div className="border border-border-subtle bg-surface p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="kicker text-[10px] text-text-faint">{title} — {unit}</p>
        <span
          className={cn(
            "kicker text-[9px] px-2 py-0.5 border",
            shape === "Contango" ? "text-bear border-bear/25" : shape === "Backwardation" ? "text-bull border-bull/25" : "text-text-faint border-rule"
          )}
        >
          {shape}
        </span>
      </div>
      <DeskLineChart series={series} height={150} />

      <table className="w-full mt-4 text-[12px]">
        <thead>
          <tr className="kicker text-[9px] text-text-faint border-b border-border-subtle">
            <th className="text-left py-1.5 font-normal">Month</th>
            <th className="text-right py-1.5 font-normal">Price</th>
            <th className="text-right py-1.5 font-normal">Roll to next</th>
            <th className="text-right py-1.5 font-normal">OI</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q, i) => {
            const next = quotes[i + 1];
            const roll = next ? next.price - q.price : null;
            return (
              <tr key={q.contract_month} className="border-b border-border-subtle/60 last:border-0">
                <td className="py-1.5 text-text-dim">{q.contract_month}</td>
                <td className="py-1.5 text-right num text-text font-medium">{q.price.toLocaleString()}</td>
                <td className={cn("py-1.5 text-right num", roll === null ? "text-text-faint" : roll > 0 ? "text-bear" : roll < 0 ? "text-bull" : "text-text-faint")}>
                  {roll === null ? "—" : `${roll > 0 ? "+" : ""}${roll.toFixed(0)}`}
                </td>
                <td className="py-1.5 text-right num text-text-faint">{q.open_interest ? q.open_interest.toLocaleString() : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="kicker text-[9px] text-text-faint mt-3">{note}</p>
    </div>
  );
}

export default function DeskCurve() {
  const { data, isLoading } = useQuery({ queryKey: ["price-board"], queryFn: api.getPriceBoard, refetchInterval: 60_000 });

  if (isLoading) return <EmptyState loading title="Loading boards…" />;
  if (!data || (data.quotes.length === 0 && data.shanghai.length === 0))
    return <EmptyState title="Boards empty" description="No contract months synced yet — the curve appears after the first SGX/Shanghai fetch." />;

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Term Structure</p>
        <h1 className="headline text-4xl font-bold text-text">Forward Curve</h1>
        <p className="text-sm text-text-dim mt-2">
          The delivery months both boards already carry, read as a curve. "Roll to next" is simply the next month's price
          minus this month's — the cost (contango, red) or gain (backwardation, green) of rolling a long position forward.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CurvePanel
          title="SGX SICOM TSR20"
          unit="USD/tonne"
          quotes={data.quotes}
          note="Feed ~15 min delayed (exchange side). Prices are the board's current marks, not settlements."
        />
        <CurvePanel
          title="Shanghai INE TSR20 (NR)"
          unit="CNY/tonne"
          quotes={data.shanghai}
          note="Real-time via the public Sina feed. CNY is deliberately not converted to USD — converting would bake an FX rate into the curve."
        />
      </div>

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Reading the shape:</span>
        Contango (curve rising) usually signals comfortable nearby supply — the market pays you to store; rolling longs
        costs money. Backwardation (curve falling) signals nearby tightness — spot is bid over deferred. The two boards
        can disagree: SGX reflects the international TSR20 trade, Shanghai reflects China's onshore balance.
      </div>
    </div>
  );
}
