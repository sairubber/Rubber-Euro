import { useQuery } from "@tanstack/react-query";
import { Anchor, Navigation } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

/** Vessel Watch — live AIS over the rubber trade's port boxes. Ships, not
 * cargoes: AIS proves a vessel's position, not what's in its holds. The
 * desk-grade signal here is congestion — vessels sitting at anchor. */

function congestionTone(anchored: number): string {
  if (anchored >= 10) return "text-bear";
  if (anchored >= 4) return "text-amber";
  return "text-bull";
}

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
          Live AIS positions inside the boxes drawn around the rubber trade's origin and discharge ports. Ships, not
          cargoes — congestion (vessels at anchor) is the desk signal here.
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
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-sm font-medium text-text">{p.port}</p>
              <p className={cn("num text-xl font-bold", congestionTone(p.anchored))}>{p.anchored}<span className="kicker text-[8px] text-text-faint font-normal ml-1">at anchor</span></p>
            </div>
            <div className="flex gap-4 text-[11px] text-text-dim mb-3">
              <span className="flex items-center gap-1"><Anchor size={11} /> {p.anchored} anchored</span>
              <span className="flex items-center gap-1"><Navigation size={11} /> {p.moving} underway</span>
              <span className="text-text-faint">{p.total} total</span>
            </div>
            {p.vessels.length > 0 ? (
              <div className="border-t border-border-subtle pt-2 max-h-40 overflow-y-auto">
                {p.vessels.map((v) => (
                  <div key={`${v.name}-${v.lat}-${v.lon}`} className="flex items-baseline justify-between py-0.5 text-[11px]">
                    <span className="text-text-dim truncate mr-2">{v.name}</span>
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
        Free aisstream.io websocket feed. Its community receiver network was probed on 2026-07-29: the Singapore Strait
        corridor — which nearly all SE Asia → China/EU rubber transits — streams live, but the origin/discharge port
        boxes themselves (Laem Chabang, Songkhla, Belawan, Vung Tau, Port Klang, Qingdao, Cochin) currently have no
        receiver coverage. Those boxes stay subscribed so data appears the day a receiver does. Counts build up over
        minutes after a backend restart. A vessel in a box is NOT confirmed rubber cargo — per-shipment manifests are
        enterprise-paid data, so this desk shows real traffic instead of guessed cargoes.
      </div>
    </div>
  );
}
