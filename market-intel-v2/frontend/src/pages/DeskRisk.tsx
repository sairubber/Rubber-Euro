import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sparkline } from "@/components/Sparkline";
import { cn } from "@/lib/utils";

/** Risk & Macro — the numbers a position-runner needs beside the price:
 * realized volatility, drawdown, ATR, a per-lot PnL calculator on real
 * contract specs, the crude substitution watch, and a free tire-demand
 * proxy. All arithmetic over public series; nothing modelled. */

function Stat({ label, value, suffix = "", tone }: { label: string; value: number | null; suffix?: string; tone?: "bull" | "bear" }) {
  return (
    <div className="border border-border-subtle bg-surface p-4">
      <p className="kicker text-[10px] text-text-faint mb-1">{label}</p>
      <p className={cn("num text-2xl font-bold", tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-text")}>
        {value === null ? "—" : `${value}${suffix}`}
      </p>
    </div>
  );
}

function PnlCalculator({ lotTonnes, front }: { lotTonnes: { sgx: number; ine: number }; front: number | null }) {
  const [lots, setLots] = useState(10);
  const [move, setMove] = useState(25);
  const [venue, setVenue] = useState<"sgx" | "ine">("sgx");
  const tonnes = venue === "sgx" ? lotTonnes.sgx : lotTonnes.ine;
  const pnl = lots * tonnes * move;

  return (
    <div className="border border-border-subtle bg-surface p-5">
      <p className="kicker text-[10px] text-text-faint mb-3">Per-lot PnL calculator — real contract sizes</p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-1">
          {(["sgx", "ine"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVenue(v)}
              className={cn(
                "kicker text-[9px] px-2 py-1 border transition-colors uppercase",
                venue === v ? "border-tsr20 text-tsr20" : "border-rule text-text-faint hover:text-text"
              )}
            >
              {v === "sgx" ? `SGX TF (${lotTonnes.sgx}t/lot)` : `INE NR (${lotTonnes.ine}t/lot)`}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="kicker text-[9px] text-text-faint block mb-1">Lots</span>
          <input type="number" value={lots} onChange={(e) => setLots(parseInt(e.target.value) || 0)} className="num w-20 border border-border-subtle bg-transparent px-2 py-1 text-sm text-text outline-none" />
        </label>
        <label className="block">
          <span className="kicker text-[9px] text-text-faint block mb-1">Price move ({venue === "sgx" ? "$" : "¥"}/tonne)</span>
          <input type="number" value={move} onChange={(e) => setMove(parseFloat(e.target.value) || 0)} className="num w-24 border border-border-subtle bg-transparent px-2 py-1 text-sm text-text outline-none" />
        </label>
        <div className="ml-auto text-right">
          <p className="kicker text-[9px] text-text-faint">PnL on the move</p>
          <p className={cn("num text-2xl font-bold", pnl > 0 ? "text-bull" : pnl < 0 ? "text-bear" : "text-text")}>
            {venue === "sgx" ? "$" : "¥"}{pnl.toLocaleString()}
          </p>
        </div>
      </div>
      <p className="kicker text-[9px] text-text-faint mt-3">
        lots × {tonnes} t/lot × move. {front ? `SGX front $${front.toFixed(0)}: a 1% move ≈ ${(front * 0.01).toFixed(0)} $/t.` : ""} Margin
        requirements are broker-specific — not shown rather than guessed.
      </p>
    </div>
  );
}

export default function DeskRisk() {
  const { data, isLoading } = useQuery({ queryKey: ["desk-risk"], queryFn: api.getRisk, refetchInterval: 900_000, refetchIntervalInBackground: true });

  if (isLoading) return <EmptyState loading title="Computing risk pack…" />;
  if (!data) return <EmptyState title="Risk pack unavailable" description="Backend not answering — check back after the next sync." />;

  const s = data.sgx;

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Risk &amp; Macro</p>
        <h1 className="headline text-4xl font-bold text-text">Risk</h1>
        <p className="text-sm text-text-dim mt-2">
          Realized volatility, drawdown and position arithmetic on real contract specs, plus the crude substitution
          watch and a free tire-demand proxy. Not investment advice.
        </p>
      </header>

      {/* Vol pack */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="SGX realized vol · 20d ann." value={s.vol_20d_pct} suffix="%" />
        <Stat label="SGX realized vol · 60d ann." value={s.vol_60d_pct} suffix="%" />
        <Stat label="Max drawdown · 6m" value={s.max_drawdown_6m_pct} suffix="%" tone="bear" />
        <Stat label="INE ATR(14)" value={data.ine.atr14_cny} suffix=" ¥/t" />
      </div>

      {/* Daily returns strip */}
      <div className="border border-border-subtle bg-surface p-5">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <p className="kicker text-[10px] text-text-faint">SGX daily returns — last 60 sessions (%)</p>
          {s.last_return_pct !== null && (
            <span className={cn("num text-sm font-bold", s.last_return_pct > 0 ? "text-bull" : s.last_return_pct < 0 ? "text-bear" : "text-text")}>
              last: {s.last_return_pct > 0 ? "+" : ""}{s.last_return_pct}%
            </span>
          )}
        </div>
        <Sparkline values={s.returns_60d} height={40} label="SGX daily returns" />
      </div>

      <PnlCalculator lotTonnes={{ sgx: data.contracts.sgx_tf_lot_tonnes, ine: data.contracts.ine_nr_lot_tonnes }} front={s.front_price} />

      {/* Substitution + demand proxies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-2">Substitution watch — Brent (crude → synthetic rubber economics)</p>
          {data.brent.last !== null ? (
            <>
              <p className="num text-2xl font-bold text-text">${data.brent.last.toFixed(2)}<span className="kicker text-[9px] text-text-faint font-normal ml-2">{data.brent.date}</span></p>
              <div className="flex gap-6 mt-2 text-sm">
                <span className="text-text-dim">NR/Brent ratio: <span className="num text-text font-bold">{data.brent.nr_brent_ratio ?? "—"}</span></span>
                <span className="text-text-dim">60d return corr: <span className="num text-text font-bold">{data.brent.corr_60d ?? "—"}</span></span>
              </div>
              <p className="kicker text-[9px] text-text-faint mt-3 leading-relaxed">
                Synthetic rubber is a crude derivative — cheap crude pressures NR demand at the margin, dear crude
                supports it. Context only; this desk trades NR.
              </p>
            </>
          ) : (
            <p className="text-sm text-text-dim">Brent feed not answering.</p>
          )}
        </div>

        <div className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-2">Tire-demand proxy — US Freight TSI (monthly)</p>
          {data.tsi.last !== null ? (
            <>
              <p className="num text-2xl font-bold text-text">
                {data.tsi.last.toFixed(1)}
                {data.tsi.yoy_pct !== null && (
                  <span className={cn("text-sm ml-2 font-bold", data.tsi.yoy_pct > 0 ? "text-bull" : "text-bear")}>
                    {data.tsi.yoy_pct > 0 ? "+" : ""}{data.tsi.yoy_pct}% yoy
                  </span>
                )}
                <span className="kicker text-[9px] text-text-faint font-normal ml-2">{data.tsi.date}</span>
              </p>
              <div className="mt-3">
                <Sparkline values={data.tsi.series.map((p) => p.value)} color="#2b4c7e" height={36} label="US Freight TSI, 3 years" />
              </div>
              <p className="kicker text-[9px] text-text-faint mt-3 leading-relaxed">
                Heavy-truck freight volume wears truck tires — the highest-NR-content tires there are. Free FRED series;
                China tire-plant operating rates are paid data (Mysteel) and are not shown rather than guessed.
              </p>
            </>
          ) : (
            <p className="text-sm text-text-dim">TSI feed not answering.</p>
          )}
        </div>
      </div>

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Method:</span>
        {data.note}
      </div>
    </div>
  );
}
