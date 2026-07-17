import { Layout } from "@/components/Layout";
import { AlertCircle, MapPin } from "lucide-react";

const PORTS = [
  { name: "Laem Chabang, Thailand", lat: 13.07, lon: 100.89 },
  { name: "Ho Chi Minh/Cat Lai, Vietnam", lat: 10.76, lon: 106.75 },
  { name: "Belawan, Indonesia", lat: 3.78, lon: 98.70 },
  { name: "Abidjan, Ivory Coast", lat: 5.25, lon: -4.00 },
  { name: "Monrovia, Liberia", lat: 6.35, lon: -10.79 },
  { name: "Singapore", lat: 1.26, lon: 103.84 },
  { name: "Qingdao, China", lat: 36.08, lon: 120.28 },
];

export default function PortTraffic() {
  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-6 mt-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">PORT TRAFFIC</h1>
          <p className="text-muted-foreground text-sm">Live AIS vessel data for key natural rubber logistics nodes.</p>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-md flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-200">
            <strong className="font-mono uppercase block mb-1">Visual Congestion Assessment</strong>
            Shows ALL vessel traffic near each port — not rubber-cargo-specific. Use for visual congestion assessment alongside the Logistics Signal on the main dashboard.
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {PORTS.map((port) => (
            <div key={port.name} className="bg-card border border-border rounded-lg overflow-hidden flex flex-col h-[400px]">
              <div className="bg-muted/30 border-b border-border p-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="font-mono text-sm font-bold truncate">{port.name}</span>
              </div>
              <div className="flex-1 bg-muted relative">
                <iframe
                  src={`https://www.marinetraffic.com/en/ais/embed/zoom:11/centery:${port.lat}/centerx:${port.lon}/maptype:4/shownames:false/showmenu:false/remember:false`}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  className="absolute inset-0"
                  title={`MarineTraffic AIS map for ${port.name}`}
                  loading="lazy"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
