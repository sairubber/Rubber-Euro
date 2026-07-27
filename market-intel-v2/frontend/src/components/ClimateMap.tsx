import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { ClimateReading, RegionSignal, RiskLevel } from "@/lib/types";

const RISK_COLOR: Record<RiskLevel, string> = {
  // Darkened for a paper ground — the dark-theme values were tuned to glow
  // against near-black and wash out completely on cream.
  Low: "#1e7a45",
  Moderate: "#9d6f1d",
  Elevated: "#c2542c",
  High: "#a11f1a",
};

function FitToMarkers({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(points, { padding: [30, 30] });
  }, [map, points]);
  return null;
}

export function ClimateMap({ climate, signals }: { climate: ClimateReading[]; signals: RegionSignal[] }) {
  const signalByRegion = new Map(signals.map((s) => [s.region, s]));
  const points: [number, number][] = climate.map((c) => [c.lat, c.lon]);

  if (climate.length === 0) return null;

  return (
    <div className="border border-border-subtle overflow-hidden">
      <MapContainer
        center={[10, 60]}
        zoom={2}
        scrollWheelZoom={false}
        style={{ height: "360px", width: "100%", background: "#efeae0" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <FitToMarkers points={points} />
        {climate.map((c) => {
          const signal = signalByRegion.get(c.region);
          const level = signal?.risk_level ?? "Low";
          const color = RISK_COLOR[level];
          return (
            <CircleMarker
              key={c.region}
              center={[c.lat, c.lon]}
              radius={8 + (signal?.composite_score ?? 0) / 8}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.65, weight: 1.5 }}
            >
              <Popup>
                <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12.5, minWidth: 200, lineHeight: 1.5 }}>
                  <p style={{ fontWeight: 700, marginBottom: 2 }}>{c.region}</p>
                  <p style={{ color: "#888", marginBottom: 6 }}>{c.country}</p>
                  <p>
                    Supply risk: <strong style={{ color }}>{level}</strong>
                    {signal && ` (${signal.composite_score.toFixed(0)}/100)`}
                    {signal?.trend && ` · ${signal.trend}`}
                  </p>
                  <p style={{ marginTop: 4 }}>
                    Rain today: <strong>{c.rainfall_mm} mm</strong>
                    <br />
                    7-day average: <strong>{c.rainfall_7d_avg_mm} mm/day</strong>
                    <br />
                    Next 7 days (forecast): <strong>{c.forecast_7d_mm} mm</strong>
                  </p>
                  {signal && signal.news_article_count > 0 && (
                    <p style={{ marginTop: 4 }}>
                      <strong>{signal.news_article_count}</strong> matched disruption report(s)
                    </p>
                  )}
                  {signal?.rationale && <p style={{ marginTop: 4, color: "#555" }}>{signal.rationale}</p>}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="px-4 py-2.5 flex items-center gap-4 border-t border-border-subtle kicker text-[10px] text-text-faint">
        {(Object.entries(RISK_COLOR) as [RiskLevel, string][]).map(([level, color]) => (
          <span key={level} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {level}
          </span>
        ))}
      </div>
    </div>
  );
}
