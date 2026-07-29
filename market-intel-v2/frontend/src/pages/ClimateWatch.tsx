import { useQuery } from "@tanstack/react-query";
import { CloudRain, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { FeedRow } from "@/components/FeedRow";
import { ClimateMap } from "@/components/ClimateMap";
import { DeskLineChart } from "@/components/DeskLineChart";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/lib/types";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const RAINFALL_TOOLTIP =
  "\"Today\" is that single day's rainfall. \"7-day avg\" is the plain mean of the last 7 daily totals from Open-Meteo (today plus the 6 days before it) — no weighting or smoothing.";

function riskTone(level: RiskLevel): "bull" | "amber" | "bear" {
  if (level === "Low") return "bull";
  if (level === "Moderate") return "amber";
  return "bear"; // Elevated / High
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "Worsening") return <TrendingUp size={12} className="text-bear" />;
  if (trend === "Improving") return <TrendingDown size={12} className="text-bull" />;
  return <Minus size={12} className="text-text-faint" />;
}

export default function ClimateWatch() {
  const { data: climate, isLoading } = useQuery({ queryKey: ["climate"], queryFn: api.getClimate, refetchInterval: 300_000, refetchIntervalInBackground: true });
  const { data: signals, isLoading: signalsLoading } = useQuery({
    queryKey: ["region-signals"],
    queryFn: api.getRegionSignals,
    refetchInterval: 300_000, refetchIntervalInBackground: true,
  });
  const { data: outlook } = useQuery({ queryKey: ["market-outlook"], queryFn: api.getMarketOutlook, refetchInterval: 300_000, refetchIntervalInBackground: true });
  const { data: alerts, isLoading: alertsLoading } = useQuery({ queryKey: ["supply-alerts"], queryFn: api.getSupplyAlerts });

  const climateByRegion = new Map((climate ?? []).map((c) => [c.region, c]));

  return (
    <div className="space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Analysis · Real Rainfall + Real News, Rule-Based</p>
        <h1 className="headline text-4xl font-bold text-text">Climate &amp; Supply Watch</h1>
        <p className="text-sm text-text-dim mt-2">
          Every score below is arithmetic over real Open-Meteo rainfall data and real scraped news counts — not AI, not
          an official index, and not investment advice.
        </p>
      </header>

      {outlook && (
        <div className={cn("border px-5 py-5", TONE_BORDER[outlook.elevated_region_count > 0 ? "bear" : "bull"])}>
          <p className="kicker text-[10px] text-text-faint mb-2">Supply Outlook — TSR20</p>
          <p className="headline text-xl font-bold text-text mb-2">{outlook.headline}</p>
          <p className="text-sm text-text-dim leading-relaxed mb-3">{outlook.summary}</p>
          <div className="flex gap-6 text-xs kicker text-text-faint">
            <span>
              <span className="text-text font-bold">{outlook.elevated_region_count}</span> / {outlook.total_regions} elevated
            </span>
            <span>
              <span className="text-text font-bold">{outlook.worsening_region_count}</span> worsening trend
            </span>
          </div>
        </div>
      )}

      {(isLoading || signalsLoading) && <EmptyState loading title="Computing regional signals…" />}

      {climate && climate.length > 0 && <ClimateMap climate={climate} signals={signals ?? []} />}

      <div>
        <p className="text-[11px] text-text-faint leading-relaxed" title={RAINFALL_TOOLTIP}>
          <span className="kicker text-[10px] text-text-dim mr-1">How to read "today · 7-day avg":</span>
          {RAINFALL_TOOLTIP}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {signals?.map((s) => {
          const c = climateByRegion.get(s.region);
          const tone = riskTone(s.risk_level);
          return (
            <div key={s.region} className={cn("border p-4", TONE_BORDER[tone])}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-medium text-text">{s.region}</p>
                  <p className="kicker text-[10px] text-text-faint">{s.country}</p>
                </div>
                <div className="text-right">
                  <span className={cn("num text-lg font-bold block", TONE_TEXT[tone])}>{s.composite_score.toFixed(0)}</span>
                  <span className={cn("kicker text-[9px]", TONE_TEXT[tone])}>{s.risk_level}</span>
                </div>
              </div>

              {c && (
                <div className="flex items-center gap-1.5 text-xs text-text-dim mb-2 flex-wrap">
                  <CloudRain size={12} className="text-text-faint" />
                  {c.rainfall_mm} mm today · {c.rainfall_7d_avg_mm} mm 7-day avg
                  {c.rainfall_mm > 2 && (
                    <span
                      className="kicker text-[8px] text-amber border border-amber/25 px-1.5 py-0.5"
                      title="Rain above ~2 mm typically stops the morning tapping round — a trade rule of thumb, not an official figure."
                    >
                      No-tapping rain
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-xs text-text-dim mb-2">
                <TrendIcon trend={s.trend} />
                {s.trend}
                {s.news_article_count > 0 && (
                  <span className="text-text-faint">
                    · {s.news_article_count} matched report{s.news_article_count !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <p className="text-[11px] text-text-faint leading-snug italic">{s.rationale}</p>
            </div>
          );
        })}
      </div>

      {signals && signals.length === 0 && !signalsLoading && (
        <EmptyState title="No signal yet" description="The desk needs at least one rainfall reading per region — check back shortly." />
      )}

      <SeasonalitySection />

      <div className="pt-6 border-t border-rule">
        <h2 className="kicker text-[11px] text-text-faint mb-1">Disruption &amp; Disease News</h2>
        <p className="text-[11px] text-text-faint mb-3">The real articles feeding the "matched reports" counts above.</p>
        {alertsLoading && <EmptyState loading title="Loading alerts…" />}
        {!alertsLoading && (!alerts || alerts.length === 0) && (
          <EmptyState title="No disruption alerts right now" description="That's a good sign — no matching news in the last scrape." />
        )}
        {alerts && alerts.length > 0 && (
          <div>
            {alerts.map((item) => (
              <FeedRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Multi-year price seasonality against the wintering calendar — INE NR
 * (TSR20) monthly settlement means since the contract's 2019 launch. Shows
 * whether the current year's path is normal seasonal shape or an anomaly. */
function SeasonalitySection() {
  const { data } = useQuery({ queryKey: ["ine-seasonality"], queryFn: api.getIneSeasonality, staleTime: 3_600_000, refetchInterval: 6 * 3_600_000, refetchIntervalInBackground: true });
  if (!data || data.envelope.length === 0) return null;

  const x = (m: number) => MONTH_ABBR[m - 1];
  const currentByMonth = new Map(data.current_year.map((c) => [c.month, c.mean]));
  const series = [
    { key: "max", label: "Historical max", color: "#c9c2b4", points: data.envelope.map((e) => ({ x: x(e.month), y: e.max })) },
    { key: "median", label: "Historical median", color: "#9d6f1d", points: data.envelope.map((e) => ({ x: x(e.month), y: e.median })) },
    { key: "min", label: "Historical min", color: "#c9c2b4", points: data.envelope.map((e) => ({ x: x(e.month), y: e.min })) },
    {
      key: "current",
      label: `${new Date().getFullYear()} so far`,
      color: "#b3202c",
      points: data.envelope.map((e) => ({ x: x(e.month), y: currentByMonth.get(e.month) })),
    },
  ];

  return (
    <div className="pt-6 border-t border-rule">
      <h2 className="kicker text-[11px] text-text-faint mb-1">Price Seasonality vs the Wintering Calendar</h2>
      <p className="text-[11px] text-text-faint mb-4 leading-relaxed">
        INE NR (TSR20) monthly settlement means across {data.years} prior years ({data.unit}) against this year's path.
        Wintering (Feb–Apr) usually tightens supply into Q2; peak tapping (Oct–Dec) loosens it. If the red line tracks
        inside the envelope, the move is seasonal shape — outside it, something else is going on. Arithmetic over the
        public Sina NR0 series; no smoothing, not investment advice.
      </p>
      <div className="border border-border-subtle bg-surface p-5">
        <DeskLineChart series={series} height={200} />
      </div>
    </div>
  );
}

const TONE_TEXT: Record<string, string> = {
  bull: "text-bull",
  amber: "text-amber",
  bear: "text-bear",
};

const TONE_BORDER: Record<string, string> = {
  bull: "border-bull/25",
  amber: "border-amber/25",
  bear: "border-bear/25",
};
