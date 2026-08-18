import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, relativeTime } from "@/lib/utils";
import type { VerdictSignal } from "@/lib/types";

/** Verdict — every desk signal aggregated in the open, grouped into four
 * plain buckets so the read is one glance, not a study session. Direction,
 * weight and reason stay visible (hover any row); the composite is a stated
 * formula, not a model. Research display, not investment advice. */

const GROUPS: { key: string; label: string; blurb: string }[] = [
  { key: "price", label: "Price & Term Structure", blurb: "Curves, momentum, open interest" },
  { key: "inventory", label: "Inventories", blurb: "Exchange warrant stocks, China" },
  { key: "supply", label: "Supply Side", blurb: "Physical basis, weather, season, news" },
  { key: "demand", label: "Demand & Macro", blurb: "Freight, substitution economics" },
];

function DirChip({ d, small }: { d: number; small?: boolean }) {
  const cls = small ? "text-[8px] px-1 py-px" : "text-[9px] px-1.5 py-0.5";
  if (d > 0)
    return (
      <span className={cn("flex items-center gap-1 kicker text-bull border border-bull/25 shrink-0", cls)}>
        <TrendingUp size={9} /> tight
      </span>
    );
  if (d < 0)
    return (
      <span className={cn("flex items-center gap-1 kicker text-bear border border-bear/25 shrink-0", cls)}>
        <TrendingDown size={9} /> surplus
      </span>
    );
  return (
    <span className={cn("flex items-center gap-1 kicker text-text-faint border border-rule shrink-0", cls)}>
      <Minus size={9} /> neutral
    </span>
  );
}

function SignalRow({ s }: { s: VerdictSignal }) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-1.5 border-b border-border-subtle/60 last:border-0"
      title={`${s.reason} (weight ${s.weight})`}
    >
      <div className="min-w-0">
        <p className="text-[12px] text-text truncate">{s.name}</p>
        <p className="num text-[11px] text-text-dim truncate">{s.reading}</p>
      </div>
      <DirChip d={s.direction} small />
    </div>
  );
}

export default function DeskVerdict() {
  const { data, isLoading } = useQuery({
    queryKey: ["desk-verdict"],
    queryFn: api.getVerdict,
    refetchInterval: 300_000,
    refetchIntervalInBackground: true,
  });

  if (isLoading) return <EmptyState loading title="Aggregating signals…" />;
  if (!data) return <EmptyState title="Verdict unavailable" description="Backend not answering — check back after the next sync." />;

  const bullish = data.score > 0;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Signal Aggregation</p>
        <h1 className="headline text-4xl font-bold text-text">Verdict</h1>
        <p className="text-sm text-text-dim mt-2">
          One glance: composite read, the drivers in plain words, and four signal buckets. Hover any signal for its
          rule and weight. Rule-based over real data — not a forecast, not investment advice.
        </p>
      </header>

      {/* Composite banner */}
      <div
        className={cn(
          "border px-6 py-6 text-center",
          data.score >= 12 ? "border-bull/25" : data.score <= -12 ? "border-bear/25" : "border-amber/25"
        )}
      >
        <p className="kicker text-[10px] text-text-faint mb-2">Composite read · {relativeTime(data.generated_at)}</p>
        <p className={cn("headline text-3xl font-bold", data.score >= 12 ? "text-bull" : data.score <= -12 ? "text-bear" : "text-amber")}>
          {data.verdict}
        </p>
        {/* Score gauge */}
        <div className="relative h-1.5 bg-rule mt-4 max-w-md mx-auto">
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-text-faint" />
          <div
            className={cn("absolute top-0 bottom-0", bullish ? "bg-bull" : "bg-bear")}
            style={bullish ? { left: "50%", width: `${data.score / 2}%` } : { right: "50%", width: `${-data.score / 2}%` }}
          />
        </div>
        <div className="flex items-center justify-center gap-8 mt-3 kicker text-[10px] text-text-faint">
          <span>
            score <span className={cn("num text-base font-bold", bullish ? "text-bull" : data.score < 0 ? "text-bear" : "text-text")}>{data.score > 0 ? "+" : ""}{data.score}</span> / ±100
          </span>
          <span>
            agreement <span className="num text-base font-bold text-text">{data.signal_agreement_pct}%</span>
          </span>
        </div>
        {/* Plain-language drivers */}
        <p className="text-[13px] text-text-dim leading-relaxed mt-4 max-w-2xl mx-auto">{data.summary}</p>
      </div>

      {/* Four buckets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {GROUPS.map((g) => {
          const sigs = data.signals.filter((s) => s.group === g.key);
          const net = data.groups[g.key]?.net ?? 0;
          return (
            <div key={g.key} className="border border-border-subtle bg-surface p-4">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <div>
                  <p className="text-sm font-medium text-text">{g.label}</p>
                  <p className="kicker text-[9px] text-text-faint">{g.blurb}</p>
                </div>
                <span className={cn("num text-lg font-bold shrink-0", net > 0 ? "text-bull" : net < 0 ? "text-bear" : "text-text-faint")}>
                  {net > 0 ? "+" : ""}{net}
                </span>
              </div>
              <div className="mt-2">
                {sigs.map((s) => (
                  <SignalRow key={s.name} s={s} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Method:</span>
        {data.method}
      </div>
    </div>
  );
}
