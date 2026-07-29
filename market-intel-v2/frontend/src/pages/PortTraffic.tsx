import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TriangleAlert, Waves } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { TYPE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { PortActivity, VesselPort } from "@/lib/types";

function marineTrafficEmbedUrl(lat: number, lon: number): string {
  return `https://www.marinetraffic.com/en/ais/embed/zoom:11/centery:${lat}/centerx:${lon}/maptype:4/shownames:false/showmenu:false/remember:false`;
}

/** Map this page's port names onto the Vessel Watch boxes and PortWatch ids
 * so each card can carry a status badge from whichever feed covers it. */
const AIS_BOX: Record<string, string> = {
  "Laem Chabang (Thailand)": "Laem Chabang / Bangkok",
  "Ho Chi Minh / Cat Lai (Vietnam)": "Ho Chi Minh / Vung Tau",
  "Belawan (Indonesia)": "Belawan (Medan)",
  "Singapore (transshipment hub)": "Singapore Strait (transit corridor)",
  "Qingdao (China)": "Qingdao",
};
const PW_NAME: Record<string, string> = {
  "Laem Chabang (Thailand)": "Laem Chabang",
  "Ho Chi Minh / Cat Lai (Vietnam)": "Vung Tau",
  "Belawan (Indonesia)": "Belawan (Medan)",
  "Qingdao (China)": "Qingdao",
};
// River-channel ports where deep-draft calls ride the tide.
const TIDE_PORTS: Record<string, { lat: number; lon: number }> = {
  "Ho Chi Minh / Cat Lai (Vietnam)": { lat: 10.34, lon: 107.08 },
  "Belawan (Indonesia)": { lat: 3.9, lon: 98.78 },
};

/** Rule-based status from whichever real feed covers this port. */
function StatusBadge({ live, pw }: { live: VesselPort | undefined; pw: PortActivity | undefined }) {
  if (live && live.total > 0) {
    const n = live.anchored_commodity;
    const tone = n >= 10 ? "text-bear border-bear/25" : n >= 4 ? "text-amber border-amber/25" : "text-bull border-bull/25";
    const label = n >= 10 ? `Severe — ${n} cargo/tanker at anchor` : n >= 4 ? `Moderate — ${n} at anchor` : `Normal — ${n} at anchor`;
    return <span className={cn("kicker text-[8px] px-1.5 py-0.5 border", tone)} title="Live AIS: anchored cargo/tanker hulls in the box right now">{label}</span>;
  }
  if (pw?.latest && pw.avg7_calls) {
    const pct = ((pw.latest.portcalls - pw.avg7_calls) / pw.avg7_calls) * 100;
    const unusual = Math.abs(pct) >= 30;
    return (
      <span
        className={cn("kicker text-[8px] px-1.5 py-0.5 border", unusual ? "text-amber border-amber/25" : "text-bull border-bull/25")}
        title={`IMF PortWatch daily satellite data (${pw.latest.date}): ${pw.latest.portcalls} calls vs ${pw.avg7_calls} 7-day avg`}
      >
        {unusual ? `Unusual — calls ${pct > 0 ? "+" : ""}${pct.toFixed(0)}% vs 7d` : `Normal activity (${pw.latest.portcalls} calls/d)`}
      </span>
    );
  }
  return <span className="kicker text-[8px] px-1.5 py-0.5 border border-rule text-text-faint" title="Neither live AIS nor PortWatch covers this port">no free feed</span>;
}

interface MarineHourly {
  hourly?: { time: string[]; sea_level_height_msl: (number | null)[] };
  timezone_abbreviation?: string;
}

/** Next high/low water from Open-Meteo Marine's modelled sea level. Model
 * output, not an official tide table — indicative for draft windows only. */
function TideBadge({ lat, lon }: { lat: number; lon: number }) {
  const { data } = useQuery<MarineHourly>({
    queryKey: ["tide", lat, lon],
    queryFn: async () => {
      const r = await fetch(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_level_height_msl&forecast_days=2&timezone=auto`
      );
      if (!r.ok) throw new Error("marine api");
      return r.json();
    },
    staleTime: 3 * 3600_000,
    retry: 1,
  });

  const hours = data?.hourly;
  if (!hours?.time?.length) return null;
  const now = new Date();
  const values = hours.sea_level_height_msl;
  const start = hours.time.findIndex((t) => new Date(t) >= now);
  if (start < 1) return null;

  let high: { t: string; v: number } | null = null;
  let low: { t: string; v: number } | null = null;
  for (let i = Math.max(start, 1); i < Math.min(hours.time.length - 1, start + 26); i++) {
    const prev = values[i - 1];
    const cur = values[i];
    const next = values[i + 1];
    if (prev === null || cur === null || next === null) continue;
    if (!high && cur >= prev && cur >= next) high = { t: hours.time[i], v: cur };
    if (!low && cur <= prev && cur <= next) low = { t: hours.time[i], v: cur };
    if (high && low) break;
  }
  if (!high && !low) return null;
  const fmt = (t: string) => t.slice(11, 16);

  return (
    <span className="flex items-center gap-1.5 kicker text-[8px] text-text-dim" title="Modelled sea level (Open-Meteo Marine), local port time — indicative draft window, not an official tide table">
      <Waves size={10} className="text-text-faint" />
      {high && <>high ~{fmt(high.t)} ({high.v.toFixed(1)}m)</>}
      {high && low && " · "}
      {low && <>low ~{fmt(low.t)} ({low.v.toFixed(1)}m)</>}
    </span>
  );
}

// Baseline liner transit times to Qingdao — published schedule ranges, for
// mental arithmetic only ("congestion today = bonded-stock gap in N days").
const ETT_ROWS = [
  { from: "Laem Chabang (Thailand)", days: "7–9" },
  { from: "Ho Chi Minh (Vietnam)", days: "8–10" },
  { from: "Belawan (Indonesia)", days: "11–13" },
  { from: "Port Klang (Malaysia)", days: "9–11" },
  { from: "Abidjan (Ivory Coast)", days: "32–35" },
];

/** In-app vessel lookup over the desk's own live AIS store — no redirect.
 * Covers ships currently inside the subscribed boxes; there is no free
 * global name/IMO API, so anything outside honestly says so. */
function VesselSearch() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["vessel-search", submitted],
    queryFn: () => api.searchVessels(submitted),
    enabled: submitted.length > 1,
    staleTime: 15_000,
  });

  return (
    <div className="max-w-2xl mx-auto">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q);
        }}
        className="flex items-center gap-2 border border-border-subtle bg-surface px-3 py-2"
      >
        <Search size={14} className="text-text-faint shrink-0" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Vessel name or MMSI — searches the desk's live AIS store"
          className="w-full bg-transparent text-sm text-text outline-none"
        />
        <button type="submit" className="kicker text-[9px] text-accent shrink-0 hover:underline">
          Lookup
        </button>
      </form>

      {submitted.length > 1 && (
        <div className="border border-border-subtle border-t-0 bg-surface px-3 py-2">
          {isFetching && <p className="text-[11px] text-text-faint py-1">Searching live store…</p>}
          {data && data.matches.length === 0 && !isFetching && (
            <p className="text-[11px] text-text-faint py-1 leading-relaxed">
              Not in the tracked boxes right now. The live store only holds ships inside the subscribed port/corridor
              boxes (last 30 min) — global name/IMO lookup is paid data, so it isn't faked here.
            </p>
          )}
          {data?.matches.map((m) => (
            <div key={m.mmsi} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border-subtle/60 last:border-0 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-text font-medium truncate">
                  {m.name}
                  <span className="kicker text-[8px] text-text-faint ml-2">{TYPE_LABEL[m.type_class]}</span>
                </p>
                <p className="kicker text-[9px] text-text-faint">MMSI {m.mmsi} · {m.port}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="num text-[12px] text-text">{m.sog !== null ? `${m.sog.toFixed(1)} kn` : "speed —"} · {m.lat.toFixed(3)}, {m.lon.toFixed(3)}</p>
                <p className="kicker text-[8px] text-text-faint">seen {m.seen_ago_s < 60 ? `${m.seen_ago_s}s` : `${Math.round(m.seen_ago_s / 60)}m`} ago</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const WINDY_REGIONS = [
  { label: "SE Asia belts", lat: 7, lon: 103, zoom: 4 },
  { label: "West Africa", lat: 6, lon: -6, zoom: 5 },
  { label: "China coast", lat: 32, lon: 122, zoom: 4 },
] as const;

// "radar" = actual live weather radar (land-based coverage only); "satellite"
// = live IR imagery (covers oceans and radar-less regions); "rain" = model
// FORECAST, not live — kept as an option but never presented as live.
const WINDY_LAYERS = [
  { key: "radar", label: "Live radar" },
  { key: "satellite", label: "Live satellite" },
  { key: "rain", label: "Rain forecast" },
] as const;

export default function PortTraffic() {
  const { data, isLoading } = useQuery({ queryKey: ["ports"], queryFn: api.getPorts });
  const { data: vessels } = useQuery({ queryKey: ["vessels"], queryFn: api.getVessels, refetchInterval: 60_000, refetchIntervalInBackground: true });
  const { data: portwatch } = useQuery({
    queryKey: ["portwatch"],
    queryFn: () => api.getPortWatch(60),
    staleTime: 3_600_000,
    refetchInterval: 3_600_000, refetchIntervalInBackground: true,
  });
  const [region, setRegion] = useState<(typeof WINDY_REGIONS)[number]>(WINDY_REGIONS[0]);
  const [layer, setLayer] = useState<(typeof WINDY_LAYERS)[number]>(WINDY_LAYERS[0]);

  const liveByBox = new Map((vessels?.ports ?? []).map((p) => [p.port, p]));
  const pwByName = new Map((portwatch?.ports ?? []).map((p) => [p.port, p]));

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Data Desk</p>
        <h1 className="headline text-4xl font-bold text-text">Port Traffic</h1>
        <p className="text-sm text-text-dim mt-2">
          Congestion maps, live rain radar over the belts, tide windows for the river ports, and baseline transit times.
        </p>
      </header>

      <VesselSearch />

      <div className="border border-amber/25 bg-amber-dim/40 px-4 py-3 text-sm text-amber flex items-start gap-2.5">
        <TriangleAlert size={16} className="shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Maps show <strong>all</strong> vessel traffic near each port — not rubber-cargo-specific. Badges: live AIS
          where the free network has coverage, IMF PortWatch daily satellite data elsewhere.
        </p>
      </div>

      {/* Rain radar — Windy embed, rain/thunder layer */}
      <section className="border border-border-subtle">
        <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium text-text">Rain over the belts — loading &amp; tapping stopper</p>
            <p className="kicker text-[9px] text-text-faint">
              Heavy rain halts crane loading of dry bales and farm tapping. Radar/satellite layers are LIVE; the rain
              layer is a model forecast. Radar only exists where land radars do — use satellite over oceans and Africa.
            </p>
          </div>
          <div className="flex gap-1 flex-wrap">
            {WINDY_LAYERS.map((l) => (
              <button
                key={l.key}
                onClick={() => setLayer(l)}
                className={cn(
                  "kicker text-[9px] px-2 py-1 border transition-colors",
                  layer.key === l.key ? "border-accent text-accent" : "border-rule text-text-faint hover:text-text"
                )}
              >
                {l.label}
              </button>
            ))}
            <span className="kicker text-[9px] text-text-faint px-1 self-center">/</span>
            {WINDY_REGIONS.map((r) => (
              <button
                key={r.label}
                onClick={() => setRegion(r)}
                className={cn(
                  "kicker text-[9px] px-2 py-1 border transition-colors",
                  region.label === r.label ? "border-tsr20 text-tsr20" : "border-rule text-text-faint hover:text-text"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <iframe
          title={`${layer.label} — ${region.label}`}
          src={`https://embed.windy.com/embed2.html?lat=${region.lat}&lon=${region.lon}&detailLat=${region.lat}&detailLon=${region.lon}&zoom=${region.zoom}&overlay=${layer.key}&level=surface&menu=&message=&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=kt&metricTemp=%C2%B0C`}
          className="w-full h-96 border-0"
          loading="lazy"
        />
      </section>

      {/* Transit-time reference */}
      <section className="border border-border-subtle bg-surface p-5">
        <p className="kicker text-[10px] text-text-faint mb-1">Baseline ocean transit to Qingdao</p>
        <p className="text-[11px] text-text-faint mb-3 leading-relaxed">
          Typical liner-schedule ranges, reference only — congestion at an origin today implies a Chinese bonded-stock
          gap this many days later.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {ETT_ROWS.map((r) => (
            <div key={r.from} className="border border-border-subtle p-3 text-center">
              <p className="text-[11px] text-text-dim leading-snug">{r.from}</p>
              <p className="num text-lg font-bold text-text mt-1">{r.days}<span className="text-[10px] font-normal text-text-faint ml-1">days</span></p>
            </div>
          ))}
        </div>
      </section>

      {isLoading && <EmptyState loading title="Loading ports…" />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {data?.map((port) => {
          const tide = TIDE_PORTS[port.name];
          return (
            <div key={port.name} className="border border-border-subtle">
              <div className="px-4 py-3 border-b border-border-subtle">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium text-text">{port.name}</p>
                  <StatusBadge live={liveByBox.get(AIS_BOX[port.name] ?? "")} pw={pwByName.get(PW_NAME[port.name] ?? "")} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5 flex-wrap">
                  <p className="kicker text-[10px] text-text-faint">
                    {port.lat.toFixed(2)}, {port.lon.toFixed(2)}
                  </p>
                  {tide && <TideBadge lat={tide.lat} lon={tide.lon} />}
                </div>
              </div>
              <iframe
                title={port.name}
                src={marineTrafficEmbedUrl(port.lat, port.lon)}
                className="w-full h-72 border-0"
                loading="lazy"
              />
            </div>
          );
        })}
      </div>

      <div className="pt-4 border-t border-rule text-[11px] text-text-faint leading-relaxed">
        <span className="kicker text-[10px] text-text-dim mr-1">Method:</span>
        Status badges use live AIS (anchored cargo/tanker hulls) where the free receiver network has coverage, and IMF
        PortWatch daily satellite figures elsewhere — the tooltip on each badge says which. Tide badges are Open-Meteo
        Marine's modelled sea level in local port time — indicative draft windows, not official tide tables; Cat Lai
        and Belawan are river ports where deep-draft calls ride high water. Transit times are typical liner ranges, not
        live schedules. The vessel search answers from the desk's own live AIS store (ships inside the subscribed
        boxes, last 30 minutes) — global name/IMO lookup is paid data and is not faked.
      </div>
    </div>
  );
}
