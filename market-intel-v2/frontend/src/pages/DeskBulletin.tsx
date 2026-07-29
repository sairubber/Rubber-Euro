import { useQuery } from "@tanstack/react-query";
import { CloudRain } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

/** Desk Bulletin — the executive morning briefing, auto-assembled from data
 * the desk already stores. Every line is rule-based arithmetic over real
 * numbers; nothing is model-written. */

function Chip({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="num text-text-faint">—</span>;
  return (
    <span className={cn("num font-bold", value > 0 ? "text-bull" : value < 0 ? "text-bear" : "text-text")}>
      {value > 0 ? "+" : ""}
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

export default function DeskBulletin() {
  const { data, isLoading } = useQuery({ queryKey: ["desk-bulletin"], queryFn: api.getBulletin, refetchInterval: 300_000, refetchIntervalInBackground: true });

  if (isLoading) return <EmptyState loading title="Assembling the bulletin…" />;
  if (!data) return <EmptyState title="Bulletin unavailable" description="The backend hasn't answered — check back after the next sync." />;

  const f = data.futures;
  const s = data.stocks;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Morning Briefing</p>
        <h1 className="headline text-4xl font-bold text-text">Desk Bulletin</h1>
        <p className="text-sm text-text-dim mt-2">{data.edition} · IST — auto-assembled from the desk's own data, rule-based, not investment advice.</p>
      </header>

      {/* Futures & curve */}
      {f && (
        <section className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-3">Futures &amp; curve</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="kicker text-[9px] text-text-faint mb-1">SGX TSR20 ({f.sgx_front_month})</p>
              <p className="num text-xl font-bold text-text">${f.sgx_price.toFixed(0)}</p>
              <p className="text-[11px]"><Chip value={f.sgx_change} /> <span className="text-text-faint">vs settle</span></p>
            </div>
            <div>
              <p className="kicker text-[9px] text-text-faint mb-1">SGX curve</p>
              <p className={cn("headline text-lg font-bold", f.sgx_curve === "Backwardation" ? "text-bull" : f.sgx_curve === "Contango" ? "text-bear" : "text-text")}>{f.sgx_curve}</p>
            </div>
            <div>
              <p className="kicker text-[9px] text-text-faint mb-1">INE NR front</p>
              <p className="num text-xl font-bold text-text">{f.ine_front_usd ? `$${f.ine_front_usd.toFixed(0)}` : "—"}</p>
              {f.ine_front_cny && <p className="text-[11px] text-text-faint num">¥{f.ine_front_cny.toLocaleString()} · {f.ine_curve}</p>}
            </div>
            <div>
              <p className="kicker text-[9px] text-text-faint mb-1">SGX − INE spread</p>
              <p className="text-xl"><Chip value={f.exchange_spread} suffix=" $/t" /></p>
            </div>
          </div>
        </section>
      )}

      {/* Physical basis + stocks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-3">Physical basis — latest sheets</p>
          {data.physicals.length === 0 && <p className="text-sm text-text-dim">No physical print stored yet.</p>}
          {data.physicals.map((p) => (
            <div key={p.grade} className="flex items-baseline justify-between py-1.5 border-b border-border-subtle/60 last:border-0">
              <span className="text-sm text-text-dim">{p.label} <span className="kicker text-[8px] text-text-faint">({p.price_date})</span></span>
              <span className="num text-sm text-text">${p.usd_mt.toFixed(0)} · basis <Chip value={p.basis} /></span>
            </div>
          ))}
        </section>

        <section className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-3">INE NR warrant stocks</p>
          {s ? (
            <>
              <p className="num text-2xl font-bold text-text">{s.tonnes.toLocaleString()} t <span className="kicker text-[9px] text-text-faint font-normal">{s.date}</span></p>
              <p className="text-sm mt-1">day <Chip value={s.daily_change} suffix=" t" /> · ~month <Chip value={s.month_change} suffix=" t" /></p>
              {s.window_position_pct !== null && (
                <p className="text-[11px] text-text-faint mt-2">
                  At {s.window_position_pct}% of the {`${s.window_low.toLocaleString()}–${s.window_high.toLocaleString()}`} t window (0% = window low). Free history reaches ~3 months — this is a window position, not a 5-year seasonal score.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-text-dim">Stock feed not answering.</p>
          )}
        </section>
      </div>

      {/* Upstream: season, rain, ENSO */}
      <section className="border border-border-subtle bg-surface p-5">
        <p className="kicker text-[10px] text-text-faint mb-3">Upstream — tapping &amp; climate</p>
        <p className="text-sm text-text mb-2">{data.tapping_season}</p>
        {data.rain_hit.length > 0 ? (
          <div className="flex flex-wrap gap-2 mb-3">
            {data.rain_hit.map((r) => (
              <span key={r.region} className="flex items-center gap-1.5 border border-amber/25 text-amber px-2.5 py-1 text-[11px]">
                <CloudRain size={12} /> {r.region} · {r.rainfall_mm} mm
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-dim mb-3">No producing belt above the 2 mm no-tapping threshold today.</p>
        )}
        {data.enso && (
          <p className="text-[12px] text-text-dim">
            <span className="kicker text-[9px] text-text-faint mr-1">ENSO (NOAA ONI {data.enso.season} {data.enso.year}):</span>
            anomaly {data.enso.anomaly > 0 ? "+" : ""}{data.enso.anomaly.toFixed(2)} °C — {data.enso.phase}
          </p>
        )}
      </section>

      {/* FX + headlines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-3">FX board</p>
          {data.fx.map((r) => (
            <div key={r.pair} className="flex items-baseline justify-between py-1 border-b border-border-subtle/60 last:border-0 text-sm">
              <span className="text-text-dim num">{r.pair}</span>
              <span className="num text-text">{r.rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {r.change_pct !== null && <Chip value={r.change_pct} suffix="%" />}</span>
            </div>
          ))}
        </section>

        <section className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-3">Last 24h — top headlines</p>
          {data.headlines.length === 0 && <p className="text-sm text-text-dim">Quiet wire — nothing in the last 24 hours (weekends are normally empty).</p>}
          {data.headlines.map((h) => (
            <a key={h.url} href={h.url} target="_blank" rel="noopener noreferrer" className="block py-1.5 border-b border-border-subtle/60 last:border-0 hover:text-accent transition-colors">
              <p className="text-[13px] text-text leading-snug">{h.title}</p>
              <p className="kicker text-[8px] text-text-faint mt-0.5">{h.source}</p>
            </a>
          ))}
        </section>
      </div>

      <p className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Method:</span>
        Assembled fresh on load from the same feeds the other tabs use — SGX board (~15 min delayed feed), INE via Sina
        (real-time), Rubber Board sheets (daily), East Money warrant mirror (daily), Open-Meteo rainfall, NOAA ONI
        (monthly). Rule-based composition; no model writes any figure or sentence here.
      </p>
    </div>
  );
}
