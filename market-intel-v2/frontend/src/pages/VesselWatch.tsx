import { useQuery } from "@tanstack/react-query";
import { Anchor, Navigation, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type { VesselPort } from "@/lib/types";

/** Vessel Watch — live AIS over the rubber trade's port boxes. Ships, not
 * cargoes: AIS proves a vessel's position, not what's in its holds. The
 * desk-grade signal is anchored COMMODITY hulls (AIS cargo/tanker types),
 * read against their own 7-day average. */

function congestionTone(anchored: number): string {
  if (anchored >= 10) return "text-bear";
  if (anchored >= 4) return "text-amber";
  return "text-bull";
}

function TrendChip({ port }: { port: VesselPort }) {
  const t = port.trend;
  // The trend needs history to mean anything — ~12 samples is two hours.
  if (!t || t.avg_7d === null || t.samples < 12)
    return <span className="kicker text-[8px] text-text-faint">trend builds over 7 days ({t?.samples ?? 0} samples)</span>;
  if (t.pct_vs_avg === null) return null;
  const up = t.pct_vs_avg > 0;
  return (
    <span className={cn("flex items-center gap-1 kicker text-[9px]", up ? "text-bear" : "text-bull")}>
      {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {up ? "+" : ""}
      {t.pct_vs_avg}% vs 7-day avg ({t.avg_7d})
    </span>
  );
}

function TrendSparkline({ port }: { port: VesselPort }) {
  const pts = port.trend?.points ?? [];
  if (pts.length < 4) return null;
  const W = 100;
  const H = 20;
  const max = Math.max(...pts.map((p) => p.anchored_commodity), 1);
  const step = W / (pts.length - 1);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - (p.anchored_commodity / max) * H).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-5 mt-1" role="img" aria-label="anchored commodity vessels, 7 days">
      <path d={d} fill="none" stroke="#2f6b4f" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const TYPE_LABEL: Record<string, string> = { cargo: "cargo", tanker: "tanker", other: "other craft", unknown: "type pending" };

export default function VesselWatch() {
  const { data, isLoading } = useQuery({ queryKey: ["vessels"], queryFn: api.getVessels, refetchInterval: 30_000 });

  if (isLoading) return <EmptyState loading title="Reading the AIS stream…" />;
  if (!data) return <EmptyState title="Vessel feed unavailable" description="Backend not answering." />;

  if (!data.configured)
    return (
      <EmptyState
        title="AIS key not configured"
        description="Set AISSTREAM_KEY in the backend environment — the free aisstream.io key powers this tab. Nothing is shown rather than something fake."
      />
    );

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Logistics</p>
        <h1 className="headline text-4xl font-bold text-text">Vessel Watch</h1>
        <p className="text-sm text-text-dim mt-2">
          Live AIS inside the rubber trade's port boxes. The headline number counts anchored cargo/tanker hulls only —
          tugs, barges and ferries are shown but never counted as congestion.
        </p>
      </header>

      <p className="kicker text-[10px] text-text-dim text-center">
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1.5", data.connected ? "bg-tsr20" : "bg-bear")} />
        {data.connected ? "Stream connected" : "Stream reconnecting…"}
        {data.last_message_age_s !== null && ` · last position ${Math.round(data.last_message_age_s)}s ago`}
        {" · anchored = SOG < "}{data.anchored_sog_kn}{" kn · positions age out after 30 min"}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.ports.map((p) => (
          <div key={p.port} className="border border-border-subtle bg-surface p-4">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-sm font-medium text-text">{p.port}</p>
              <p className={cn("num text-xl font-bold", congestionTone(p.anchored_commodity))}>
                {p.anchored_commodity}
                <span className="kicker text-[8px] text-text-faint font-normal ml-1">cargo/tanker at anchor</span>
              </p>
            </div>
            <TrendChip port={p} />
            <TrendSparkline port={p} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-dim my-2">
              <span className="flex items-center gap-1"><Anchor size={11} /> {p.anchored} anchored (all)</span>
              <span className="flex items-center gap-1"><Navigation size={11} /> {p.moving} underway</span>
              <span className="text-text-faint">{p.cargo} cargo · {p.tanker} tanker · {p.other} other · {p.unknown} pending</span>
            </div>
            {p.vessels.length > 0 ? (
              <div className="border-t border-border-subtle pt-2 max-h-40 overflow-y-auto">
                {p.vessels.map((v) => (
                  <div key={`${v.name}-${v.lat}-${v.lon}`} className="flex items-baseline justify-between py-0.5 text-[11px]">
                    <span className={cn("truncate mr-2", v.type_class === "cargo" || v.type_class === "tanker" ? "text-text" : "text-text-faint")}>
                      {v.name}
                      <span className="kicker text-[8px] text-text-faint ml-1.5">{TYPE_LABEL[v.type_class]}</span>
                    </span>
                    <span className="num text-text-faint shrink-0">{v.sog !== null ? `${v.sog.toFixed(1)} kn` : "—"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-text-faint">
                No positions — the free receiver network has no coverage in this box today (box stays subscribed).
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Method &amp; coverage honesty:</span>
        Free aisstream.io websocket feed. Ship types come from AIS ShipStaticData broadcasts (cargo = type 70–79,
        tanker = 80–89) — a vessel shows "type pending" until its static message arrives, usually within minutes. The
        7-day trend compares anchored cargo/tanker hulls against their own average from ten-minute snapshots; it needs
        history to accumulate before it says anything. Coverage probed 2026-07-29: the Singapore Strait corridor
        streams live, but the origin/discharge port boxes (Laem Chabang, Songkhla, Belawan, Vung Tau, Port Klang,
        Qingdao, Cochin) have no free receiver coverage — they stay subscribed and say so, and no "estimated activity"
        is invented for them: the monthly customs data that could stand in is filed too patchily to be honest (it lives
        with proper framing on the Trade &amp; Supply tab). Commercial gap-fillers (Spire, MarineTraffic) are paid —
        parked with the other paid feeds. A vessel in a box is NOT confirmed rubber cargo.
      </div>
    </div>
  );
}
