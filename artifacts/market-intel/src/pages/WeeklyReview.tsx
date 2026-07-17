import { useState } from "react";
import { useGetWeeklyReport, useGetSystemStatus } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, TrendingUp, AlertCircle, ArrowRight } from "lucide-react";
import { formatIST } from "@/lib/utils";

function MarketWeekly({ market }: { market: string }) {
  const { data: report, isLoading } = useGetWeeklyReport(market, {
    query: { enabled: !!market, queryKey: [market, 'weekly'] }
  });

  if (isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  if (!report) {
    return (
      <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground text-sm font-mono">
        No weekly report available for {market}.
      </div>
    );
  }

  const p = report.payload;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col font-sans">
      <div className="bg-muted/20 border-b border-border p-5 flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-sm font-bold bg-primary/20 text-primary px-2 py-0.5 rounded border border-primary/30">
              {market}
            </span>
            <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" /> WEEK START: {p.week_start || report.week_start}
            </span>
          </div>
          <h2 className="text-lg font-bold">Weekly Assessment</h2>
        </div>
        <div className="text-right">
          <span className="block font-mono text-[10px] text-muted-foreground mb-1 uppercase">Conviction Trend</span>
          <Badge variant="outline" className="font-mono uppercase bg-background">
            {p.conviction_trend}
          </Badge>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="bg-primary/10 border-l-4 border-primary p-4 rounded-r-md">
          <h3 className="font-mono text-xs font-bold text-primary mb-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> NET WEEKLY ASSESSMENT
          </h3>
          <p className="text-sm font-medium leading-relaxed">{p.net_weekly_assessment}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3 border border-border p-4 rounded-md bg-card/50">
            <h3 className="font-mono text-xs font-bold text-muted-foreground border-b border-border pb-2">PERSISTENT SIGNALS</h3>
            <ul className="space-y-2">
              {p.persistent_signals?.map((s: string, i: number) => (
                <li key={i} className="text-sm text-foreground/80 flex gap-2">
                  <span className="text-primary">▸</span> <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3 border border-border p-4 rounded-md bg-card/50">
            <h3 className="font-mono text-xs font-bold text-muted-foreground border-b border-border pb-2">ONE-OFF NOISE</h3>
            <ul className="space-y-2">
              {p.one_off_noise?.map((s: string, i: number) => (
                <li key={i} className="text-sm text-foreground/80 flex gap-2">
                  <span className="text-muted-foreground">○</span> <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {p.triggers_fired && p.triggers_fired.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-mono text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Triggers Fired
            </h3>
            <div className="border border-border rounded-md overflow-hidden bg-background">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-mono text-[10px]">TRIGGER</TableHead>
                    <TableHead className="font-mono text-[10px]">IMPACT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.triggers_fired.map((t: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm font-mono">{t.trigger_name || t.trigger || typeof t === 'string' ? t : JSON.stringify(t)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.impact || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="border-t border-border pt-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <h3 className="font-mono text-xs font-bold text-muted-foreground uppercase mb-2">Scenario Drift</h3>
              <p className="text-sm text-foreground/80 italic">{p.scenario_drift_summary}</p>
            </div>
            <div className="flex-1">
              <h3 className="font-mono text-xs font-bold text-muted-foreground uppercase mb-2">Key Question for Next Week</h3>
              <div className="bg-accent/50 p-3 rounded border border-border text-sm font-medium">
                {p.key_question_next_week}
              </div>
            </div>
          </div>
        </div>

        {p.week_ahead_calendar && p.week_ahead_calendar.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-border">
            <h3 className="font-mono text-xs font-bold text-muted-foreground uppercase">Week Ahead Calendar</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {p.week_ahead_calendar.map((item: any, i: number) => (
                <div key={i} className="flex gap-3 p-3 border border-border rounded bg-card/30">
                  <div className="font-mono text-xs font-bold text-primary shrink-0 w-16">{item.date}</div>
                  <div>
                    <div className="text-sm font-medium">{item.event}</div>
                    {item.expected_impact && <div className="text-[10px] text-muted-foreground mt-1 uppercase">IMPACT: {item.expected_impact}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="bg-muted/10 p-3 border-t border-border text-xs font-mono text-muted-foreground text-center">
        Report Generated: {formatIST(report.created_at)}
      </div>
    </div>
  );
}

export default function WeeklyReview() {
  const { data: status } = useGetSystemStatus();
  const markets = status?.markets || ["TSR20", "EURUSD"];
  const [activeMarket, setActiveMarket] = useState(markets[0]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6 mt-4">
        <div className="flex justify-between items-end border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">WEEKLY REVIEW</h1>
            <p className="text-muted-foreground text-sm">Persistent signals vs noise and look-ahead for the coming week.</p>
          </div>
          <div className="flex gap-2">
            {markets.map(m => (
              <button
                key={m}
                onClick={() => setActiveMarket(m)}
                className={`font-mono text-sm px-4 py-2 rounded-md transition-colors border ${activeMarket === m ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground border-border hover:bg-accent'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <MarketWeekly key={activeMarket} market={activeMarket} />
      </div>
    </Layout>
  );
}
