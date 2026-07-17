import * as React from "react"
import { cn, formatIST } from "@/lib/utils"
import { Badge } from "./ui/badge"
import { Progress } from "./ui/progress"
import { CollapsibleSection } from "./CollapsibleSection"
import { useTriggerMarketRun } from "@workspace/api-client-react"
import { RefreshCw, AlertTriangle, Info, MapPin, Database, Anchor, History, ActivitySquare, AlertCircle } from "lucide-react"
import { Button } from "./ui/button"

export function AnalysisCard({ analysis, onRefresh }: { analysis: any, onRefresh?: () => void }) {
  const p = analysis.payload || {};
  const isDelta = p.delta_report?.is_delta_mode;
  
  const triggerRun = useTriggerMarketRun();

  const handleRefresh = () => {
    triggerRun.mutate({ market: analysis.market }, {
      onSuccess: () => {
        if (onRefresh) onRefresh();
      }
    });
  };

  const getConvictionColor = (scoreStr: string) => {
    const score = parseInt(scoreStr) || 0;
    if (score <= 3) return "red";
    if (score <= 6) return "amber";
    return "green";
  };

  const getDirectionColor = (dir: string) => {
    if (!dir) return "gray";
    const d = dir.toLowerCase();
    if (d.includes("increasing") || d.includes("bullish") || d.includes("up")) return "text-green-400 bg-green-500/10 border-green-500/30";
    if (d.includes("decreasing") || d.includes("bearish") || d.includes("down")) return "text-red-400 bg-red-500/10 border-red-500/30";
    if (d.includes("stable") || d.includes("neutral")) return "text-gray-400 bg-gray-500/10 border-gray-500/30";
    return "text-muted-foreground bg-muted/50 border-border";
  };

  return (
    <div className="bg-card border border-card-border rounded-lg shadow-xl overflow-hidden flex flex-col font-sans">
      {/* Header */}
      <div className="p-5 border-b border-border/50 space-y-4">
        <div className="flex justify-between items-start gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="font-mono text-xs font-bold px-2 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded">
                {analysis.market}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {formatIST(analysis.created_at)}
              </span>
              {isDelta && (
                <Badge variant="secondary" className="font-mono text-[10px]">DELTA UPDATE</Badge>
              )}
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">{p.news_headline || p.executive_summary?.slice(0, 50)}</h2>
          </div>
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={triggerRun.isPending} className="shrink-0 h-8 font-mono text-xs">
              <RefreshCw className={cn("w-3 h-3 mr-2", triggerRun.isPending && "animate-spin")} />
              {triggerRun.isPending ? "RUNNING" : "REFRESH"}
            </Button>
          )}
        </div>

        {/* Badge Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {p.source_reliability && (
            <Badge variant="outline" className={cn("text-[10px] uppercase font-mono", 
              p.source_reliability === "Verified" ? "border-green-500/50 text-green-400" :
              p.source_reliability === "Speculative" ? "border-red-500/50 text-red-400" :
              "border-amber-500/50 text-amber-400"
            )}>
              SRC: {p.source_reliability}
            </Badge>
          )}
          {p.impact_horizon?.category && (
            <Badge variant="outline" className="text-[10px] uppercase font-mono border-blue-500/50 text-blue-400">
              HZ: {p.impact_horizon.category}
            </Badge>
          )}
          {p.market_regime && (
            <Badge variant="outline" className="text-[10px] uppercase font-mono border-purple-500/50 text-purple-400">
              REGIME: {p.market_regime.split(" ")[0]}
            </Badge>
          )}
          {p.research_verdict?.conviction_score && (
            <Badge variant={getConvictionColor(p.research_verdict.conviction_score)} className="text-[10px] uppercase font-mono ml-auto">
              CONVICTION: {p.research_verdict.conviction_score}/10
            </Badge>
          )}
        </div>

        {p.raw_event_summary && p.raw_event_summary.length > 0 && (
          <ul className="list-none space-y-1 mt-3">
            {p.raw_event_summary.map((point: string, idx: number) => (
              <li key={idx} className="text-sm text-muted-foreground flex gap-2">
                <span className="text-primary mt-1">▸</span> <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Delta Panel */}
      {isDelta && p.delta_report && (
        <div className="bg-blue-950/20 border-b border-blue-900/50 p-4">
          <h3 className="font-mono text-xs font-bold text-blue-400 flex items-center gap-2 mb-3">
            <ActivitySquare className="w-4 h-4" /> WHAT CHANGED
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-mono text-[10px] text-muted-foreground uppercase block mb-1">New Developments</span>
              <p className="text-blue-100/80 leading-relaxed">{p.delta_report.new_developments || "None"}</p>
            </div>
            <div>
              <span className="font-mono text-[10px] text-muted-foreground uppercase block mb-1">Signals Flipped</span>
              <p className="text-blue-100/80 leading-relaxed">{p.delta_report.signals_flipped || "None"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Executive Summary */}
      <div className="p-5 border-b border-border/50">
        <p className="text-sm leading-relaxed text-foreground/90 font-medium">
          {p.executive_summary}
        </p>
      </div>

      {/* Scenario Bars */}
      {p.scenario_analysis && (
        <div className="p-5 border-b border-border/50 bg-card/30">
          <h3 className="font-mono text-xs font-bold text-muted-foreground mb-4">SCENARIO PROBABILITIES</h3>
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-green-400 font-bold">BULL CASE</span>
                <span className="text-green-400">{p.scenario_analysis.bull_case?.probability_percent || 0}%</span>
              </div>
              <Progress value={parseInt(p.scenario_analysis.bull_case?.probability_percent || 0)} indicatorClassName="bg-green-500" className="bg-green-500/10 h-1.5" />
              <p className="text-[11px] text-muted-foreground pt-1">{p.scenario_analysis.bull_case?.thesis}</p>
            </div>
            
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-red-400 font-bold">BEAR CASE</span>
                <span className="text-red-400">{p.scenario_analysis.bear_case?.probability_percent || 0}%</span>
              </div>
              <Progress value={parseInt(p.scenario_analysis.bear_case?.probability_percent || 0)} indicatorClassName="bg-red-500" className="bg-red-500/10 h-1.5" />
              <p className="text-[11px] text-muted-foreground pt-1">{p.scenario_analysis.bear_case?.thesis}</p>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-gray-400 font-bold">NEUTRAL CASE</span>
                <span className="text-gray-400">{p.scenario_analysis.neutral_case?.probability_percent || 0}%</span>
              </div>
              <Progress value={parseInt(p.scenario_analysis.neutral_case?.probability_percent || 0)} indicatorClassName="bg-gray-500" className="bg-gray-500/10 h-1.5" />
              <p className="text-[11px] text-muted-foreground pt-1">{p.scenario_analysis.neutral_case?.thesis}</p>
            </div>
          </div>
        </div>
      )}

      {/* Accordions */}
      <div className="p-4 space-y-2 flex-1">
        {p.global_supply_signals && p.global_supply_signals.length > 0 && (
          <CollapsibleSection title="Supply Signals" defaultOpen>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {p.global_supply_signals.map((sig: any, idx: number) => {
                const isDim = !sig.signal || sig.signal.toLowerCase().includes("no new signal");
                return (
                  <div key={idx} className={cn("p-2 rounded border text-xs flex flex-col gap-1", 
                    isDim ? "border-border/30 opacity-50" : getDirectionColor(sig.direction)
                  )}>
                    <div className="font-mono font-bold truncate flex items-center justify-between">
                      {sig.region}
                      {!isDim && <span className="text-[9px] uppercase opacity-70">{sig.direction}</span>}
                    </div>
                    <div className="opacity-90 line-clamp-2" title={sig.signal}>{sig.signal}</div>
                  </div>
                )
              })}
            </div>
            {p.supply_diversification_note && (
              <p className="mt-3 text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
                {p.supply_diversification_note}
              </p>
            )}
          </CollapsibleSection>
        )}

        {p.global_demand_signals && p.global_demand_signals.length > 0 && (
          <CollapsibleSection title="Demand Signals">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {p.global_demand_signals.map((sig: any, idx: number) => {
                const isDim = !sig.signal || sig.signal.toLowerCase().includes("no new signal");
                return (
                  <div key={idx} className={cn("p-2 rounded border text-xs flex flex-col gap-1", 
                    isDim ? "border-border/30 opacity-50" : getDirectionColor(sig.direction)
                  )}>
                    <div className="font-mono font-bold truncate flex items-center justify-between">
                      {sig.region}
                      {!isDim && <span className="text-[9px] uppercase opacity-70">{sig.direction}</span>}
                    </div>
                    <div className="opacity-90">{sig.signal}</div>
                  </div>
                )
              })}
            </div>
            {p.demand_diversification_note && (
              <p className="mt-3 text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
                {p.demand_diversification_note}
              </p>
            )}
          </CollapsibleSection>
        )}

        {p.logistics_signal && p.logistics_signal.length > 0 && (
          <CollapsibleSection title="Logistics & Freight" badge={<Anchor className="w-3 h-3 text-muted-foreground" />}>
            <div className="space-y-2">
              {p.logistics_signal.map((sig: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center p-2 bg-card border border-border/50 rounded">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3 h-3 text-muted-foreground" />
                    <span className="text-sm font-mono">{sig.route}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className={cn("px-1.5 py-0.5 rounded", 
                      sig.congestion_status?.toLowerCase().includes("high") ? "bg-red-500/20 text-red-400" :
                      sig.congestion_status?.toLowerCase().includes("moderate") ? "bg-amber-500/20 text-amber-400" :
                      "bg-green-500/20 text-green-400"
                    )}>
                      {sig.congestion_status}
                    </span>
                    <span className="text-muted-foreground">|</span>
                    <span className={cn("px-1.5 py-0.5 rounded",
                      sig.freight_trend?.toLowerCase().includes("up") ? "text-red-400" :
                      sig.freight_trend?.toLowerCase().includes("down") ? "text-green-400" :
                      "text-gray-400"
                    )}>
                      {sig.freight_trend}
                    </span>
                  </div>
                </div>
              ))}
              {p.logistics_note && <p className="text-xs text-muted-foreground mt-2">{p.logistics_note}</p>}
            </div>
          </CollapsibleSection>
        )}

        {(p.inventory_signal || p.currency_passthrough_signal) && (
          <CollapsibleSection title="Inventory & Currency" badge={<Database className="w-3 h-3 text-muted-foreground" />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {p.inventory_signal && (
                <div className="space-y-2">
                  <h4 className="font-mono text-[10px] text-muted-foreground uppercase">Inventory</h4>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SICOM:</span>
                      <span className="font-mono">{p.inventory_signal.sicom_warehouse_trend || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Qingdao:</span>
                      <span className="font-mono">{p.inventory_signal.qingdao_stockpile_trend || '-'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground italic pt-1">{p.inventory_signal.interpretation}</p>
                  </div>
                </div>
              )}
              {p.currency_passthrough_signal && (
                <div className="space-y-2">
                  <h4 className="font-mono text-[10px] text-muted-foreground uppercase">Currency ({p.currency_passthrough_signal.local_currency})</h4>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">vs USD:</span>
                      <span className="font-mono">{p.currency_passthrough_signal.trend_vs_usd || '-'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground italic pt-1">{p.currency_passthrough_signal.selling_incentive_effect}</p>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {p.official_reports_referenced && p.official_reports_referenced.length > 0 && (
          <CollapsibleSection title="Official Reports">
            <div className="space-y-3">
              {p.official_reports_referenced.map((rep: any, idx: number) => (
                <div key={idx} className="border-l-2 border-primary/50 pl-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold">{rep.body}</span>
                    <span className="text-[10px] text-muted-foreground">{rep.publication_date}</span>
                  </div>
                  <div className="text-xs font-medium text-foreground/80">{rep.report_name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{rep.key_data_extracted}</div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {(p.cross_market_correlation || p.second_order_effects || p.historical_analog) && (
          <CollapsibleSection title="Deeper Analysis" badge={<History className="w-3 h-3 text-muted-foreground" />}>
            <div className="space-y-4">
              {p.cross_market_correlation && (
                <div>
                  <h4 className="font-mono text-[10px] text-muted-foreground uppercase mb-1">Cross-Market</h4>
                  <p className="text-xs">
                    <span className="font-mono text-primary mr-1">{p.cross_market_correlation.primary_asset}</span>
                    <span className="text-muted-foreground">↔</span>
                    <span className="font-mono text-primary ml-1">{p.cross_market_correlation.linked_asset}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{p.cross_market_correlation.mechanism}</p>
                </div>
              )}
              {p.second_order_effects && p.second_order_effects.length > 0 && (
                <div>
                  <h4 className="font-mono text-[10px] text-muted-foreground uppercase mb-1">Second-Order Effects</h4>
                  <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                    {p.second_order_effects.map((ef: string, idx: number) => <li key={idx}>{ef}</li>)}
                  </ul>
                </div>
              )}
              {p.historical_analog && (
                <div>
                  <h4 className="font-mono text-[10px] text-muted-foreground uppercase mb-1">Historical Analog</h4>
                  <p className="text-xs font-mono mb-1">{p.historical_analog.precedent_event}</p>
                  <p className="text-xs text-muted-foreground italic">Outcome: {p.historical_analog.past_outcome}</p>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}
      </div>

      {/* Warnings & Gaps Footer */}
      {(p.data_gaps?.length > 0 || p.contradiction_flag) && (
        <div className="p-4 bg-card/50 border-t border-border/50 flex flex-col gap-2">
          {p.contradiction_flag && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-3 flex gap-3 text-sm text-red-200">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-mono text-[10px] font-bold text-red-400 block mb-1">CONTRADICTION DETECTED</span>
                {p.contradiction_flag}
              </div>
            </div>
          )}
          {p.data_gaps && p.data_gaps.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 flex gap-3 text-sm text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-mono text-[10px] font-bold text-amber-400 block mb-1">DATA GAPS</span>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  {p.data_gaps.map((gap: string, idx: number) => <li key={idx}>{gap}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
