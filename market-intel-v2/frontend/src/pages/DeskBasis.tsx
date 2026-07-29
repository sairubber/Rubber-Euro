import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeskLineChart } from "@/components/DeskLineChart";
import { cn, relativeTime } from "@/lib/utils";

/** Basis & Spreads — physical FOB/spot quotes against the SGX TSR20 front
 * month, everything in $/tonne. The one screen a hedging desk reads first:
 * positive basis = physical premium = tight spot market. */

const BASIS_COLORS: Record<string, string> = {
  SMR20: "#2f6b4f", // house green — block rubber, same spec family as the future
  ISNR20: "#2b4c7e", // milky blue — Indian block
  RSS3: "#9d6f1d", // smoked-sheet amber
};

function BasisChip({ value }: { value: number }) {
  const positive = value > 0;
  return (
    <span className={cn("num text-lg font-bold", positive ? "text-bull" : value < 0 ? "text-bear" : "text-text")}>
      {positive ? "+" : ""}
      {value.toFixed(0)}
    </span>
  );
}

export default function DeskBasis() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["desk-basis"],
    queryFn: () => api.getBasis(120),
    refetchInterval: 120_000,
  });

  if (isLoading) return <EmptyState loading title="Computing basis…" />;
  if (isError || !data)
    return <EmptyState title="Basis unavailable" description="The SGX board or the Rubber Board sheets haven't been fetched yet — check back after the next sync." />;

  const basisSeries = data.physicals.map((p) => ({
    key: `basis_${p.grade.toLowerCase()}`,
    label: `${p.grade} basis`,
    color: BASIS_COLORS[p.grade] ?? "#8c4f73",
    points: data.history.map((h) => ({
      x: h.date.slice(5),
      y: h[`basis_${p.grade.toLowerCase()}` as keyof typeof h] as number | undefined,
    })),
  }));

  const priceSeries = [
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
  ];

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Physical vs Futures</p>
        <h1 className="headline text-4xl font-bold text-text">Basis &amp; Spreads</h1>
        <p className="text-sm text-text-dim mt-2">
          Published physical quotes minus the SGX TSR20 front month, all converted to $/tonne. Arithmetic over official
          numbers — nothing modelled, not investment advice.
        </p>
      </header>

      {/* Futures leg */}
      <div className="border border-border-subtle bg-surface p-5 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <p className="kicker text-[10px] text-text-faint mb-1">Futures leg — SGX TSR20 ({data.front_month})</p>
          <p className="num text-3xl font-bold text-text">
            ${data.sgx_price.toFixed(0)}
            <span className="text-sm font-normal text-text-faint ml-1">/tonne</span>
          </p>
        </div>
        <div>
          <p className="kicker text-[10px] text-text-faint mb-1">Last settlement</p>
          <p className="num text-xl text-text-dim">${data.sgx_close.toFixed(0)}</p>
        </div>
        {data.sgx_price_as_of && (
          <p className="kicker text-[9px] text-text-faint ml-auto self-end" title={data.sgx_price_as_of}>
            SGX price as of {relativeTime(data.sgx_price_as_of)} · feed ~15 min delayed
          </p>
        )}
      </div>

      {/* Physical legs + basis */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {data.physicals.map((p) => (
          <div key={p.grade} className="border border-border-subtle bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="kicker text-[10px]" style={{ color: BASIS_COLORS[p.grade] }}>
                  {p.label}
                </p>
                <p className="kicker text-[9px] text-text-faint mt-0.5">
                  {p.kind === "sheet" ? "Ribbed smoked sheet" : "Block rubber (TSR spec)"} · {p.price_date}
                </p>
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
          </div>
        ))}
      </div>

      {/* Grade / origin spreads */}
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

      {/* Basis history */}
      <div className="border border-border-subtle bg-surface p-5">
        <p className="kicker text-[10px] text-text-faint mb-4">Basis history — physical minus SGX settlement, $/tonne</p>
        <DeskLineChart series={basisSeries} zeroLine unit="" />
      </div>

      {/* Outright prices */}
      <div className="border border-border-subtle bg-surface p-5">
        <p className="kicker text-[10px] text-text-faint mb-4">Outright prices — $/tonne</p>
        <DeskLineChart series={priceSeries} unit="" />
      </div>

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Method:</span>
        {data.source}. Rubber Board publishes per 100 kg — figures here are ×10 for the $/tonne scale. Each physical
        print pairs with the most recent SGX settlement on or before its date; days without a published sheet produce no
        point. SMR20 and ISNR20 are technically-specified 20 grades — the same spec family the SGX contract settles on;
        RSS3 is sheet rubber, so its "basis" mixes grade premium with true basis and is best read alongside the
        RSS3&nbsp;−&nbsp;SMR20 spread. ISNR20 is Kottayam's domestic market price — its premium over SGX includes
        India's import-duty wall, so read it as the Indian buyer's alternative cost, not a pure export basis.
      </div>
    </div>
  );
}
