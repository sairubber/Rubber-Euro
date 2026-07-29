import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeskLineChart } from "@/components/DeskLineChart";
import { cn, relativeTime } from "@/lib/utils";

/** Basis & Spreads.
 *
 * Primary view: the LIVE cross-exchange spread — SGX SICOM TSR20 against
 * Shanghai INE NR (CNY converted at the live rate), per contract month,
 * refetched every 10 s so it moves as the boards move.
 *
 * Secondary view: physical basis from the Rubber Board's official daily
 * sheets — that data prints once a day, and is labelled as such. */

const BASIS_COLORS: Record<string, string> = {
  STR20: "#9d6f1d", // Thai amber — TRA FOB Laem Chabang
  SMR20: "#2f6b4f", // house green — block rubber, same spec family as the future
  ISNR20: "#2b4c7e", // milky blue — Indian block
};

function BasisChip({ value, size = "text-lg" }: { value: number; size?: string }) {
  const positive = value > 0;
  return (
    <span className={cn("num font-bold", size, positive ? "text-bull" : value < 0 ? "text-bear" : "text-text")}>
      {positive ? "+" : ""}
      {value.toFixed(0)}
    </span>
  );
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 mr-1.5">
      <span className="pulse-ring absolute inline-flex h-1.5 w-1.5 text-tsr20" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-tsr20" />
    </span>
  );
}

export default function DeskBasis() {
  // Live leg: the same board feed the Prices tab runs on — SGX poll is
  // per-minute (exchange feed itself ~15 min delayed), Shanghai and FX are
  // real-time, and this query re-asks every 10 s.
  const { data: board } = useQuery({ queryKey: ["price-board"], queryFn: api.getPriceBoard, refetchInterval: 10_000 });
  // Daily leg: physical sheets — they only change once a day.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["desk-basis"],
    queryFn: () => api.getBasis(120),
    refetchInterval: 120_000,
  });

  const cnyusd = board?.fx.find((f) => f.pair === "CNYUSD")?.rate ?? null;
  const shanghaiByMonth = new Map((board?.shanghai ?? []).map((q) => [q.contract_month, q]));
  const exchangeRows = (board?.quotes ?? [])
    .map((q) => {
      const sh = shanghaiByMonth.get(q.contract_month);
      if (!sh || !cnyusd) return null;
      const ineUsd = sh.price * cnyusd;
      return {
        month: q.contract_month,
        sgx: q.price,
        ineCny: sh.price,
        ineUsd,
        spread: q.price - ineUsd,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const front = exchangeRows[0];

  if (isLoading && !board) return <EmptyState loading title="Computing basis…" />;

  const basisSeries = (data?.physicals ?? []).map((p) => ({
    key: `basis_${p.grade.toLowerCase()}`,
    label: `${p.grade} basis`,
    color: BASIS_COLORS[p.grade] ?? "#8c4f73",
    points: (data?.history ?? []).map((h) => ({
      x: h.date.slice(5),
      y: h[`basis_${p.grade.toLowerCase()}` as keyof typeof h] as number | undefined,
    })),
  }));

  const priceSeries = data
    ? [
        {
          key: "sgx",
          label: `SGX TSR20 settle`,
          color: "#b3202c",
          points: data.history.map((h) => ({ x: h.date.slice(5), y: h.sgx_settle })),
        },
        ...data.physicals.map((p) => ({
          key: p.grade.toLowerCase(),
          label: p.label,
          color: BASIS_COLORS[p.grade] ?? "#8c4f73",
          points: data.history.map((h) => ({
            x: h.date.slice(5),
            y: h[p.grade.toLowerCase() as keyof typeof h] as number | undefined,
          })),
        })),
      ]
    : [];

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Exchange &amp; Physical</p>
        <h1 className="headline text-4xl font-bold text-text">Basis &amp; Spreads</h1>
        <p className="text-sm text-text-dim mt-2">
          The live SGX-vs-Shanghai spread on top, the official daily physical sheets below — all in $/tonne. Arithmetic
          over real prices, nothing modelled, not investment advice.
        </p>
      </header>

      {/* ── LIVE: cross-exchange spread ─────────────────────────────────── */}
      <section>
        <p className="kicker text-[10px] text-text-dim mb-3">
          <LiveDot />
          Exchange spread — SGX SICOM TSR20 vs Shanghai INE NR · updates every 10 s
        </p>

        {!front && <EmptyState title="Boards not aligned yet" description="Waiting for both exchanges' contract months to sync." />}

        {front && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="border border-tsr20/25 bg-surface p-5">
              <p className="kicker text-[10px] text-text-faint mb-1">Front month spread ({front.month})</p>
              <p className="num text-4xl font-bold text-text">
                {front.spread > 0 ? "+" : ""}
                {front.spread.toFixed(0)}
                <span className="text-sm font-normal text-text-faint ml-1">$/tonne</span>
              </p>
              <p className="text-[11px] text-text-dim mt-2 leading-snug">
                SGX ${front.sgx.toFixed(0)} − INE ${front.ineUsd.toFixed(0)} (¥{front.ineCny.toLocaleString()} ×{" "}
                {cnyusd?.toFixed(4)})
              </p>
              <p className="kicker text-[9px] text-text-faint mt-2">
                Positive = international market over China onshore. SGX leg carries the exchange's ~15 min feed delay;
                INE and FX are real-time.
              </p>
            </div>

            <div className="lg:col-span-2 border border-border-subtle bg-surface p-5 overflow-x-auto">
              <p className="kicker text-[10px] text-text-faint mb-3">Spread by contract month — $/tonne</p>
              <table className="w-full text-[12px] min-w-[420px]">
                <thead>
                  <tr className="kicker text-[9px] text-text-faint border-b border-border-subtle">
                    <th className="text-left py-1.5 font-normal">Month</th>
                    <th className="text-right py-1.5 font-normal">SGX $</th>
                    <th className="text-right py-1.5 font-normal">INE ¥</th>
                    <th className="text-right py-1.5 font-normal">INE $</th>
                    <th className="text-right py-1.5 font-normal">Spread $</th>
                  </tr>
                </thead>
                <tbody>
                  {exchangeRows.map((r) => (
                    <tr key={r.month} className="border-b border-border-subtle/60 last:border-0">
                      <td className="py-1.5 text-text-dim">{r.month}</td>
                      <td className="py-1.5 text-right num text-text font-medium">{r.sgx.toFixed(0)}</td>
                      <td className="py-1.5 text-right num text-text-faint">{r.ineCny.toLocaleString()}</td>
                      <td className="py-1.5 text-right num text-text-dim">{r.ineUsd.toFixed(0)}</td>
                      <td className={cn("py-1.5 text-right num font-bold", r.spread > 0 ? "text-bull" : r.spread < 0 ? "text-bear" : "text-text")}>
                        {r.spread > 0 ? "+" : ""}
                        {r.spread.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {board?.sgx_price_as_of && (
                <p className="kicker text-[9px] text-text-faint mt-3" title={board.sgx_price_as_of}>
                  SGX price as of {relativeTime(board.sgx_price_as_of)} · INE real-time via Sina · CNYUSD live
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── DAILY: physical basis from official sheets ──────────────────── */}
      {data && data.physicals.length > 0 && (
        <section className="space-y-4 pt-4 border-t border-rule">
          <p className="kicker text-[10px] text-text-dim">
            Physical basis — Rubber Board official sheets · prints once per market day
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {data.physicals.map((p) => (
              <div key={p.grade} className="border border-border-subtle bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="kicker text-[10px]" style={{ color: BASIS_COLORS[p.grade] }}>
                      {p.label}
                    </p>
                    <p className="kicker text-[9px] text-text-faint mt-0.5">Block rubber (TSR spec) · {p.price_date}</p>
                  </div>
                </div>
                <p className="num text-2xl font-bold text-text mt-3">
                  ${p.usd_mt.toFixed(0)}
                  <span className="text-xs font-normal text-text-faint ml-1">/tonne</span>
                </p>
                <div className="mt-3 pt-3 border-t border-border-subtle flex items-baseline justify-between">
                  <span className="kicker text-[9px] text-text-faint">Basis vs SGX {data.front_month}</span>
                  <BasisChip value={p.basis} />
                </div>
                {p.basis_ine !== null && (
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="kicker text-[9px] text-text-faint">vs INE (USD-converted)</span>
                    <BasisChip value={p.basis_ine} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {data.spreads.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.spreads.map((s) => (
                <div key={s.label} className="border border-border-subtle bg-surface p-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-text num">{s.label}</p>
                    <p className="kicker text-[9px] text-text-faint mt-0.5">{s.note}</p>
                  </div>
                  <BasisChip value={s.value} />
                </div>
              ))}
            </div>
          )}

          <div className="border border-border-subtle bg-surface p-5">
            <p className="kicker text-[10px] text-text-faint mb-4">Physical basis history — physical minus SGX settlement, $/tonne</p>
            <DeskLineChart series={basisSeries} zeroLine unit="" />
          </div>

          <div className="border border-border-subtle bg-surface p-5">
            <p className="kicker text-[10px] text-text-faint mb-4">Outright prices — $/tonne</p>
            <DeskLineChart series={priceSeries} unit="" />
          </div>
        </section>
      )}

      {isError && (
        <EmptyState title="Physical sheets unavailable" description="The Rubber Board data hasn't been fetched yet — the live exchange spread above still works." />
      )}

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Method:</span>
        SGX and Shanghai INE are the only exchanges with a liquid TSR20 contract — Thailand and Vietnam are physical
        origin markets with no rubber futures exchange, and the Japan (JPX-OSE) TSR20 contract carries no volume. The
        INE leg is converted from CNY at the live CNYUSD rate for comparison only; INE is China's onshore bonded
        market, so the spread also reflects Chinese import economics. Physical sheets: Rubber Board of India, published
        per 100 kg and shown ×10 as $/tonne; each print pairs with the most recent SGX settlement on or before its
        date. STR20 is the Thai Rubber Association's own FOB Laem Chabang offer price, published in THB/kg and
        converted at the live USDTHB rate (history keeps each day's own conversion). SMR20, ISNR20 and STR20 are all
        TSR-spec grades; sheet grades (RSS) stay off this screen because the desk trades TSR20 only. ISNR20 is
        Kottayam's domestic price — its premium includes India's import-duty wall. Indonesia SIR20, Vietnam SVR20 and
        Ivory Coast AFR20 have no free official daily feed (GAPKINDO/VRA publish to members only) — absent rather than
        estimated.
      </div>
    </div>
  );
}
