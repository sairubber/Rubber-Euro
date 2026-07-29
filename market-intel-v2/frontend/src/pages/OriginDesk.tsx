import { useQuery } from "@tanstack/react-query";
import { CloudRain } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeskLineChart } from "@/components/DeskLineChart";
import { cn } from "@/lib/utils";

/** Origin Desk — the upstream picture: official physical sheets per market,
 * the tapping calendar, and which producing regions rain shut down today.
 * Physical data is the Rubber Board of India's daily publication (it covers
 * Bangkok and Kuala Lumpur international sheets too). */

// TSR20-spec grades only — the desk doesn't trade sheet (RSS) or latex.
const KEY_GRADES = [
  { location: "KualaLumpur", grade: "SMR20", label: "SMR20 · Kuala Lumpur", color: "#2f6b4f" },
  { location: "Kottayam", grade: "ISNR20", label: "ISNR20 · Kottayam", color: "#2b4c7e" },
];

/** Thailand's leg comes from a different source (TRA FOB widget, THB→USD at
 * each day's fetched rate) so it gets its own card instead of the
 * PhysicalPrice-backed sparkline. */
function ThaiFobCard() {
  const { data } = useQuery({ queryKey: ["thai-fob"], queryFn: () => api.getThaiFob(120), staleTime: 300_000 });
  const points = (data?.series ?? [])
    .filter((p) => p.usd_mt !== null)
    .map((p) => ({ x: p.price_date.slice(5), y: p.usd_mt as number }));
  const latest = data?.latest;

  return (
    <div className="border border-border-subtle bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="kicker text-[10px]" style={{ color: "#9d6f1d" }}>STR20 · Laem Chabang FOB</p>
        {latest && <span className="kicker text-[9px] text-text-faint">{latest.price_date}</span>}
      </div>
      {latest?.usd_mt ? (
        <p className="num text-xl font-bold text-text mb-2">
          ${latest.usd_mt.toFixed(0)}
          <span className="text-xs font-normal text-text-faint ml-1">/tonne</span>
          <span className="num text-[11px] font-normal text-text-dim ml-2">{latest.thb_kg.toFixed(2)} THB/kg</span>
        </p>
      ) : (
        <p className="text-[11px] text-text-faint mb-2">TRA print not fetched yet.</p>
      )}
      <DeskLineChart series={[{ key: "str20", label: "STR20 FOB (TRA)", color: "#9d6f1d", points }]} height={90} />
      <p className="kicker text-[8px] text-text-faint mt-2">TRA offer price · THB→USD at each day's live rate</p>
    </div>
  );
}

const TSR_GRADE = /ISNR|SMR|TSR|STR|SIR|SVR/i;

// The classic SE Asia + India tapping calendar. Month is 1-12.
function tappingPhase(month: number): { phase: string; tone: "bull" | "amber" | "bear"; note: string } {
  if (month >= 2 && month <= 4)
    return { phase: "Wintering", tone: "bear", note: "Leaf shedding across SE Asia & India — tapping typically drops 50–70%." };
  if (month >= 10 && month <= 12)
    return { phase: "Peak tapping", tone: "bull", note: "Maximum production window across SE Asia & India." };
  return { phase: "Normal tapping", tone: "amber", note: "Between wintering (Feb–Apr) and the Oct–Dec peak." };
}

const NO_TAPPING_MM = 2;

function GradeSparkline({ location, grade, label, color }: (typeof KEY_GRADES)[number]) {
  const { data } = useQuery({
    queryKey: ["physical-history", location, grade],
    queryFn: () => api.getPhysicalHistory(location, grade, 120),
    staleTime: 300_000,
  });
  const points = (data ?? [])
    .filter((p) => p.usd !== null)
    .map((p) => ({ x: p.price_date.slice(5), y: (p.usd as number) * 10 }));
  const latest = points[points.length - 1];
  const first = points[0];
  const change = latest && first && first.y !== 0 ? ((latest.y - first.y) / first.y) * 100 : null;

  return (
    <div className="border border-border-subtle bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="kicker text-[10px]" style={{ color }}>{label}</p>
        {change !== null && (
          <span className={cn("num text-[11px]", change > 0 ? "text-bull" : change < 0 ? "text-bear" : "text-text-faint")}>
            {change > 0 ? "+" : ""}
            {change.toFixed(1)}% over window
          </span>
        )}
      </div>
      {latest && (
        <p className="num text-xl font-bold text-text mb-2">
          ${latest.y.toFixed(0)}
          <span className="text-xs font-normal text-text-faint ml-1">/tonne</span>
        </p>
      )}
      <DeskLineChart series={[{ key: grade, label, color, points }]} height={90} />
    </div>
  );
}

export default function OriginDesk() {
  const { data: physical, isLoading } = useQuery({ queryKey: ["physical"], queryFn: api.getPhysical, refetchInterval: 300_000 });
  const { data: climate } = useQuery({ queryKey: ["climate"], queryFn: api.getClimate, refetchInterval: 300_000 });

  const month = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", month: "numeric" }));
  const season = tappingPhase(month);
  const rainHit = (climate ?? []).filter((c) => c.rainfall_mm > NO_TAPPING_MM);

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Upstream</p>
        <h1 className="headline text-4xl font-bold text-text">Origin Desk</h1>
        <p className="text-sm text-text-dim mt-2">
          Official physical sheets, the tapping calendar, and today's rain across producing belts — the cost floor under
          every futures print.
        </p>
      </header>

      {/* Season + rain strip */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={cn("border p-5", season.tone === "bull" ? "border-bull/25" : season.tone === "bear" ? "border-bear/25" : "border-amber/25")}>
          <p className="kicker text-[10px] text-text-faint mb-1">Tapping calendar — SE Asia &amp; India</p>
          <p className={cn("headline text-2xl font-bold", season.tone === "bull" ? "text-bull" : season.tone === "bear" ? "text-bear" : "text-amber")}>
            {season.phase}
          </p>
          <p className="text-sm text-text-dim mt-1">{season.note}</p>
          <p className="kicker text-[9px] text-text-faint mt-2">
            Calendar rule of thumb, not a measurement. West Africa (Ivory Coast) runs a different cycle.
          </p>
        </div>

        <div className="border border-border-subtle bg-surface p-5">
          <p className="kicker text-[10px] text-text-faint mb-2">Rain-hit belts today — morning rain &gt;{NO_TAPPING_MM} mm usually stops tapping</p>
          {rainHit.length === 0 ? (
            <p className="text-sm text-text-dim">No producing region above {NO_TAPPING_MM} mm today — tapping weather across the belts.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {rainHit.map((c) => (
                <span key={c.region} className="flex items-center gap-1.5 border border-amber/25 text-amber px-2.5 py-1 text-[11px]">
                  <CloudRain size={12} />
                  {c.region} · {c.rainfall_mm} mm
                </span>
              ))}
            </div>
          )}
          <p className="kicker text-[9px] text-text-faint mt-3">
            Daily totals from Open-Meteo (real data, no key). The &gt;{NO_TAPPING_MM} mm cut-off is the trade's rule of
            thumb for lost tapping mornings — not an official figure.
          </p>
        </div>
      </div>

      {/* Key grade sparklines */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ThaiFobCard />
        {KEY_GRADES.map((g) => (
          <GradeSparkline key={g.grade} {...g} />
        ))}
      </div>

      {/* Full physical matrix */}
      {isLoading && <EmptyState loading title="Loading physical sheets…" />}
      {physical && physical.locations.length > 0 && (
        <div>
          <p className="kicker text-[10px] text-text-faint mb-3">
            TSR20-spec physical matrix — USD/tonne · {physical.source ?? "Rubber Board of India"} + TRA Thailand
          </p>
          <p className="text-[11px] text-text-faint mb-3 leading-relaxed">
            Country coverage honesty: Thailand (TRA FOB), Malaysia (SMR20) and India (ISNR20) have free official daily
            prints. Indonesia SIR20, Vietnam SVR20 and Ivory Coast AFR20 are published to GAPKINDO/VRA members only —
            no free official feed exists, so they are absent rather than estimated.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {physical.locations
              .map((loc) => ({ ...loc, rows: loc.rows.filter((r) => TSR_GRADE.test(r.grade)) }))
              .filter((loc) => loc.rows.length > 0)
              .map((loc) => (
              <div key={loc.location} className="border border-border-subtle bg-surface p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-sm font-medium text-text">{loc.location}</p>
                  <p className="kicker text-[9px] text-text-faint">{loc.price_date}</p>
                </div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="kicker text-[9px] text-text-faint border-b border-border-subtle">
                      <th className="text-left py-1 font-normal">Grade</th>
                      <th className="text-right py-1 font-normal">$/tonne</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loc.rows
                      .filter((r) => r.usd !== null)
                      .map((r) => (
                        <tr key={r.grade} className="border-b border-border-subtle/60 last:border-0">
                          <td className="py-1 text-text-dim">{r.grade}</td>
                          <td className="py-1 text-right num text-text">{((r.usd as number) * 10).toFixed(0)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
      {physical && physical.locations.length === 0 && !isLoading && (
        <EmptyState title="No physical sheets yet" description="The Rubber Board parser hasn't stored a sheet yet — it fills in on the next scheduled sync." />
      )}
    </div>
  );
}
