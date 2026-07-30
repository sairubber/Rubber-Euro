import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeskLineChart } from "@/components/DeskLineChart";
import { cn } from "@/lib/utils";
import type { FuturesQuote } from "@/lib/types";

/** Forward Curve — term structure on both TSR20 exchanges, plus the desk
 * analytics that hang off it: annualized roll yield, OI-roll detection, the
 * China import-parity (arb) matrix, producing-nation FX translation, and
 * the cross-exchange spread history. All arithmetic over live/official
 * numbers — nothing modelled. */

const AVG_MONTH_DAYS = 30.44;

function curveShape(quotes: FuturesQuote[]): "Contango" | "Backwardation" | "Flat" {
  if (quotes.length < 2) return "Flat";
  const diff = quotes[quotes.length - 1].price - quotes[0].price;
  if (Math.abs(diff) < 1) return "Flat";
  return diff > 0 ? "Contango" : "Backwardation";
}

/** Annualized roll yield for a long rolling M1 → M2:
 * (M1 − M2)/M1 × 365/daysBetween × 100. Positive in backwardation. */
function rollYieldPct(m1: FuturesQuote, m2: FuturesQuote): number | null {
  const months = m2.month_order - m1.month_order;
  if (months <= 0 || !m1.price) return null;
  return ((m1.price - m2.price) / m1.price) * (365 / (months * AVG_MONTH_DAYS)) * 100;
}

/** OI migrating out of the front into the next month = participants rolling. */
function oiRollSignal(quotes: FuturesQuote[]): string | null {
  if (quotes.length < 2) return null;
  const front = quotes[0];
  const next = quotes[1];
  if (front.oi_change < 0 && next.oi_change > 0 && Math.abs(front.oi_change) >= Math.max(front.open_interest * 0.05, 20)) {
    return `OI rolling ${front.contract_month} → ${next.contract_month}: front ${front.oi_change.toLocaleString()}, next +${next.oi_change.toLocaleString()}`;
  }
  return null;
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
  const rollSignal = oiRollSignal(quotes);

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

      <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] mt-4 text-[12px]">
        <thead>
          <tr className="kicker text-[9px] text-text-faint border-b border-border-subtle">
            <th className="text-left py-1.5 font-normal whitespace-nowrap">Month</th>
            <th className="text-right py-1.5 font-normal whitespace-nowrap">Price</th>
            <th className="text-right py-1.5 font-normal whitespace-nowrap">Roll to next</th>
            <th className="text-right py-1.5 font-normal whitespace-nowrap" title="Annualized: (M1−M2)/M1 × 365/days between contracts. Positive = backwardation pays longs to roll.">
              Roll yld %/yr
            </th>
            <th className="text-right py-1.5 font-normal">OI</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q, i) => {
            const next = quotes[i + 1];
            const roll = next ? next.price - q.price : null;
            const ry = next ? rollYieldPct(q, next) : null;
            return (
              <tr key={q.contract_month} className="border-b border-border-subtle/60 last:border-0">
                <td className="py-1.5 text-text-dim">{q.contract_month}</td>
                <td className="py-1.5 text-right num text-text font-medium">{q.price.toLocaleString()}</td>
                <td className={cn("py-1.5 text-right num", roll === null ? "text-text-faint" : roll > 0 ? "text-bear" : roll < 0 ? "text-bull" : "text-text-faint")}>
                  {roll === null ? "—" : `${roll > 0 ? "+" : ""}${roll.toFixed(0)}`}
                </td>
                <td className={cn("py-1.5 text-right num", ry === null ? "text-text-faint" : ry > 0 ? "text-bull" : ry < 0 ? "text-bear" : "text-text-faint")}>
                  {ry === null ? "—" : `${ry > 0 ? "+" : ""}${ry.toFixed(1)}%`}
                </td>
                <td className="py-1.5 text-right num text-text-faint">{q.open_interest ? q.open_interest.toLocaleString() : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {rollSignal && (
        <p className="kicker text-[9px] text-amber border border-amber/25 px-2 py-1 mt-3 inline-block">{rollSignal}</p>
      )}
      <p className="kicker text-[9px] text-text-faint mt-3">{note}</p>
    </div>
  );
}

const SPREAD_WINDOWS = [30, 90, 180] as const;

export default function DeskCurve() {
  const { data, isLoading } = useQuery({ queryKey: ["price-board"], queryFn: api.getPriceBoard, refetchInterval: 60_000, refetchIntervalInBackground: true });
  const { data: spreadHist } = useQuery({
    queryKey: ["spread-history"],
    queryFn: () => api.getSpreadHistory(180),
    staleTime: 900_000,
    refetchInterval: 900_000, refetchIntervalInBackground: true, // both legs settle once per session; 15 min keeps the tail fresh
  });
  const [spreadWindow, setSpreadWindow] = useState<(typeof SPREAD_WINDOWS)[number]>(90);
  const [arbCost, setArbCost] = useState(35);

  const cnyusd = data?.fx.find((f) => f.pair === "CNYUSD")?.rate ?? null;
  const usdthb = data?.fx.find((f) => f.pair === "USDTHB");
  const usdidr = data?.fx.find((f) => f.pair === "USDIDR");

  const shanghaiByMonth = new Map((data?.shanghai ?? []).map((q) => [q.contract_month, q]));
  const arbRows = useMemo(
    () =>
      (data?.quotes ?? [])
        .map((q) => {
          const sh = shanghaiByMonth.get(q.contract_month);
          if (!sh || !cnyusd) return null;
          const ineUsd = sh.price * cnyusd;
          const gross = ineUsd - q.price;
          return { month: q.contract_month, sgx: q.price, ineUsd, gross, net: gross - arbCost };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    [data, cnyusd, arbCost] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (isLoading) return <EmptyState loading title="Loading boards…" />;
  if (!data || (data.quotes.length === 0 && data.shanghai.length === 0))
    return <EmptyState title="Boards empty" description="No contract months synced yet — the curve appears after the first SGX/Shanghai fetch." />;

  const front = data.quotes[0];
  const spreadSeries = (spreadHist?.series ?? []).slice(-spreadWindow);

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Term Structure</p>
        <h1 className="headline text-4xl font-bold text-text">Forward Curve</h1>
        <p className="text-sm text-text-dim mt-2">
          Term structure on both TSR20 exchanges, with roll economics, the China import-parity window, and the
          cross-exchange spread history.
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
          note="Real-time via the public Sina feed. CNY is deliberately not converted to USD in this table — the arb matrix below does the conversion explicitly."
        />
      </div>

      {/* Arb / import parity matrix */}
      {arbRows.length > 0 && (
        <section className="border border-border-subtle bg-surface p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <p className="kicker text-[10px] text-text-faint">China import parity — INE (USD-converted) minus SGX, per month</p>
            <label className="flex items-baseline gap-2 kicker text-[9px] text-text-faint">
              Freight + bonded handling
              <span className="flex items-baseline gap-1 border border-border-subtle px-2 py-1">
                <input
                  type="number"
                  value={arbCost}
                  step={5}
                  onChange={(e) => setArbCost(parseFloat(e.target.value) || 0)}
                  className="num w-14 bg-transparent text-text text-[12px] outline-none text-right"
                />
                <span>$/t</span>
              </span>
            </label>
          </div>
          <p className="text-[11px] text-text-faint mb-3 leading-relaxed">
            INE NR is China's BONDED contract — quoted duty- and VAT-free, so the parity needs no tax term: a positive
            net margin means bonded rubber bought at SGX-linked prices and delivered into INE warehouses earns the
            difference. Costs are yours to edit; live CNYUSD {cnyusd?.toFixed(4)}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[520px]">
              <thead>
                <tr className="kicker text-[9px] text-text-faint border-b border-border-subtle">
                  <th className="text-left py-1.5 font-normal">Month</th>
                  <th className="text-right py-1.5 font-normal">SGX $</th>
                  <th className="text-right py-1.5 font-normal">INE $</th>
                  <th className="text-right py-1.5 font-normal">Gross $</th>
                  <th className="text-right py-1.5 font-normal">Net after costs $</th>
                  <th className="text-right py-1.5 font-normal">Window</th>
                </tr>
              </thead>
              <tbody>
                {arbRows.map((r) => (
                  <tr key={r.month} className="border-b border-border-subtle/60 last:border-0">
                    <td className="py-1.5 text-text-dim">{r.month}</td>
                    <td className="py-1.5 text-right num text-text">{r.sgx.toFixed(0)}</td>
                    <td className="py-1.5 text-right num text-text">{r.ineUsd.toFixed(0)}</td>
                    <td className={cn("py-1.5 text-right num", r.gross > 0 ? "text-bull" : "text-bear")}>
                      {r.gross > 0 ? "+" : ""}
                      {r.gross.toFixed(0)}
                    </td>
                    <td className={cn("py-1.5 text-right num font-bold", r.net > 0 ? "text-bull" : "text-bear")}>
                      {r.net > 0 ? "+" : ""}
                      {r.net.toFixed(0)}
                    </td>
                    <td className="py-1.5 text-right">
                      <span className={cn("kicker text-[8px] px-1.5 py-0.5 border", r.net > 0 ? "text-bull border-bull/25" : "text-text-faint border-rule")}>
                        {r.net > 0 ? "OPEN" : "closed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Producing-nation FX translation */}
      {front && (usdthb || usdidr) && (
        <section className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-3">SGX front month in producing-nation currency</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {usdthb && (
              <div className="flex items-baseline justify-between border border-border-subtle p-3">
                <span className="text-sm text-text-dim">Thailand (THB/kg)</span>
                <span className="num text-lg font-bold text-text">
                  ฿{((front.price * usdthb.rate) / 1000).toFixed(2)}
                  {usdthb.change_pct !== null && (
                    <span className={cn("text-[11px] font-normal ml-2", usdthb.change_pct > 0 ? "text-bull" : usdthb.change_pct < 0 ? "text-bear" : "text-text-faint")}>
                      THB {usdthb.change_pct > 0 ? "weaker" : usdthb.change_pct < 0 ? "stronger" : ""} {Math.abs(usdthb.change_pct)}%
                    </span>
                  )}
                </span>
              </div>
            )}
            {usdidr && (
              <div className="flex items-baseline justify-between border border-border-subtle p-3">
                <span className="text-sm text-text-dim">Indonesia (IDR/kg)</span>
                <span className="num text-lg font-bold text-text">
                  Rp{((front.price * usdidr.rate) / 1000).toFixed(0)}
                  {usdidr.change_pct !== null && (
                    <span className={cn("text-[11px] font-normal ml-2", usdidr.change_pct > 0 ? "text-bull" : usdidr.change_pct < 0 ? "text-bear" : "text-text-faint")}>
                      IDR {usdidr.change_pct > 0 ? "weaker" : usdidr.change_pct < 0 ? "stronger" : ""} {Math.abs(usdidr.change_pct)}%
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
          <p className="kicker text-[9px] text-text-faint mt-3">
            SGX front × live USD rate ÷ 1000. A sharply weaker baht/rupiah lets origin exporters cut USD offers while
            keeping local margin — pressure on SGX. Green = local currency weakening (exporter-friendly).
          </p>
        </section>
      )}

      {/* Cross-exchange spread history */}
      <section className="border border-border-subtle bg-surface p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="kicker text-[10px] text-text-faint">SGX − INE spread history — settlements, $/tonne</p>
          <div className="flex gap-1">
            {SPREAD_WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setSpreadWindow(w)}
                className={cn(
                  "kicker text-[9px] px-2 py-1 border transition-colors",
                  spreadWindow === w ? "border-tsr20 text-tsr20" : "border-rule text-text-faint hover:text-text"
                )}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>
        {spreadSeries.length > 3 ? (
          <DeskLineChart
            series={[
              {
                key: "spread",
                label: "SGX front − INE NR0 (USD)",
                color: "#b3202c",
                points: spreadSeries.map((p) => ({ x: p.date.slice(5), y: p.spread })),
              },
            ]}
            zeroLine
            height={180}
          />
        ) : (
          <p className="text-[11px] text-text-faint py-6 text-center">Spread history loading — needs both settlement feeds to answer.</p>
        )}
        {spreadHist && <p className="kicker text-[9px] text-text-faint mt-2">{spreadHist.note} INE leg is the NR0 main-contract continuous series.</p>}
      </section>

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Reading the shape:</span>
        Contango (curve rising) usually signals comfortable nearby supply — the market pays you to store; rolling longs
        costs money. Backwardation (curve falling) signals nearby tightness — spot is bid over deferred. Roll yield
        annualizes that cost/gain per month-pair. The two boards can disagree: SGX reflects the international TSR20
        trade, Shanghai reflects China's onshore balance — the arb matrix quantifies that disagreement after your own
        freight assumption.
      </div>
    </div>
  );
}
