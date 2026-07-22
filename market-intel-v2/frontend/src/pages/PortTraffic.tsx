import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";

function marineTrafficEmbedUrl(lat: number, lon: number): string {
  return `https://www.marinetraffic.com/en/ais/embed/zoom:11/centery:${lat}/centerx:${lon}/maptype:4/shownames:false/showmenu:false/remember:false`;
}

export default function PortTraffic() {
  const { data, isLoading } = useQuery({ queryKey: ["ports"], queryFn: api.getPorts });

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Data Desk</p>
        <h1 className="headline text-4xl font-bold text-text">Port Traffic</h1>
        <p className="text-sm text-text-dim mt-2">Live vessel congestion at key rubber export ports, via MarineTraffic.</p>
      </header>

      <div className="border border-amber/25 bg-amber-dim/40 px-4 py-3 text-sm text-amber flex items-start gap-2.5">
        <TriangleAlert size={16} className="shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Shows <strong>all</strong> vessel traffic near each port — not rubber-cargo-specific. Use for visual congestion
          assessment alongside the Trade &amp; Supply news feed.
        </p>
      </div>

      {isLoading && <EmptyState loading title="Loading ports…" />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {data?.map((port) => (
          <div key={port.name} className="border border-border-subtle">
            <div className="px-4 py-3 border-b border-border-subtle">
              <p className="text-sm font-medium text-text">{port.name}</p>
              <p className="kicker text-[10px] text-text-faint">
                {port.lat.toFixed(2)}, {port.lon.toFixed(2)}
              </p>
            </div>
            <iframe
              title={port.name}
              src={marineTrafficEmbedUrl(port.lat, port.lon)}
              className="w-full h-72 border-0"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
