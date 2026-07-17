import { useState, useRef } from "react";
import { useGetAnalysesWithOutcomes, useRecordOutcome, useGetScorecard, useRunScorecard, useGetSystemStatus } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Target, BarChart2, Loader2, ArrowRight } from "lucide-react";
import { formatIST } from "@/lib/utils";

function OutcomeForm({ market, analysisId, currentOutcome }: { market: string, analysisId: number, currentOutcome?: string }) {
  const [outcomeText, setOutcomeText] = useState(currentOutcome || "");
  const recordOutcome = useRecordOutcome();
  const mutateFnRef = useRef(recordOutcome.mutate);
  mutateFnRef.current = recordOutcome.mutate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcomeText.trim()) return;
    mutateFnRef.current({ data: { market, analysis_id: analysisId, outcome_text: outcomeText } });
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={outcomeText}
        onChange={(e) => setOutcomeText(e.target.value)}
        placeholder="Enter actual outcome..."
        className="h-8 font-mono text-xs min-w-[200px]"
      />
      <Button type="submit" size="sm" className="h-8 shrink-0 font-mono text-xs" disabled={recordOutcome.isPending || !outcomeText.trim() || outcomeText === currentOutcome}>
        {recordOutcome.isPending ? "SAVING" : (currentOutcome ? "UPDATE" : "RECORD")}
      </Button>
    </form>
  );
}

function MarketScorecard({ market }: { market: string }) {
  const { data: analyses, isLoading: loadingAnalyses } = useGetAnalysesWithOutcomes(market, {
    query: { enabled: !!market, queryKey: [market, 'analyses-outcomes'] }
  });
  
  const { data: scorecard, isLoading: loadingScorecard, refetch: refetchScorecard } = useGetScorecard(market, {
    query: { enabled: !!market, queryKey: [market, 'scorecard'] }
  });
  
  const runScorecard = useRunScorecard();

  const handleRunScorecard = () => {
    runScorecard.mutate({ market }, {
      onSuccess: () => refetchScorecard()
    });
  };

  return (
    <div className="space-y-8">
      {/* Scorecard Results Panel */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="bg-muted/30 border-b border-border p-4 flex justify-between items-center">
          <h2 className="font-mono font-bold flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> MODEL PERFORMANCE SCORECARD
          </h2>
          <Button 
            onClick={handleRunScorecard} 
            disabled={runScorecard.isPending}
            variant="outline" 
            size="sm" 
            className="font-mono text-xs h-8"
          >
            {runScorecard.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <BarChart2 className="w-3 h-3 mr-2" />}
            GENERATE SCORECARD
          </Button>
        </div>

        {loadingScorecard ? (
          <div className="p-6"><Skeleton className="h-32 w-full" /></div>
        ) : !scorecard ? (
          <div className="p-8 text-center text-muted-foreground text-sm font-mono">
            No scorecard exists. Enter outcomes below and generate to evaluate model performance.
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {scorecard.payload?.recommended_prompt_adjustments && (
              <div className="bg-primary/10 border border-primary/30 p-4 rounded-md">
                <h3 className="font-mono text-xs font-bold text-primary mb-2 uppercase">Recommended Prompt Adjustments</h3>
                <p className="text-sm font-mono whitespace-pre-wrap text-primary/90">{scorecard.payload.recommended_prompt_adjustments}</p>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-mono text-[10px] text-muted-foreground uppercase mb-2">Calibration Summary</h3>
                <p className="text-sm">{scorecard.payload?.calibration_summary}</p>
              </div>
              <div>
                <h3 className="font-mono text-[10px] text-muted-foreground uppercase mb-2">Systematic Bias Detected</h3>
                <p className="text-sm">{scorecard.payload?.systematic_bias_detected}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border">
              <div>
                <h3 className="font-mono text-[10px] text-muted-foreground uppercase mb-3">Best Performing Signals</h3>
                <ul className="space-y-1">
                  {scorecard.payload?.best_performing_signal_types?.map((s: string, i: number) => (
                    <li key={i} className="text-xs font-mono flex items-center gap-2">
                      <Check className="w-3 h-3 text-green-500" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-mono text-[10px] text-muted-foreground uppercase mb-3">Worst Performing Signals</h3>
                <ul className="space-y-1">
                  {scorecard.payload?.worst_performing_signal_types?.map((s: string, i: number) => (
                    <li key={i} className="text-xs font-mono flex items-center gap-2">
                      <span className="text-red-500 font-bold">×</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground text-right pt-2">
              Generated: {formatIST(scorecard.created_at)}
            </div>
          </div>
        )}
      </div>

      {/* Outcome Entry Table */}
      <div>
        <h3 className="text-lg font-bold mb-4">Analysis History & Outcomes</h3>
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="font-mono text-[10px]">DATE</TableHead>
                <TableHead className="font-mono text-[10px]">HEADLINE & PREDICTION</TableHead>
                <TableHead className="font-mono text-[10px]">ACTUAL OUTCOME</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingAnalyses ? (
                <TableRow><TableCell colSpan={3} className="h-24 text-center"><Skeleton className="h-4 w-full" /></TableCell></TableRow>
              ) : !analyses || analyses.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground text-sm">No analysis history found.</TableCell></TableRow>
              ) : (
                analyses.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap align-top pt-4">
                      {formatIST(a.created_at).split(' ')[0]}
                      <div className="text-[10px] text-muted-foreground mt-1">ID: {a.id}</div>
                    </TableCell>
                    <TableCell className="align-top pt-4">
                      <div className="font-medium text-sm mb-1">{a.headline || `Analysis run (${a.run_mode})`}</div>
                      <Badge variant="outline" className="font-mono text-[9px]">PREDICTED CONVICTION: {a.conviction || 'N/A'}/10</Badge>
                    </TableCell>
                    <TableCell className="align-top pt-4">
                      <OutcomeForm market={market} analysisId={a.id} currentOutcome={a.outcome_text || ""} />
                      {a.outcome_entered_at && (
                        <div className="text-[9px] font-mono text-muted-foreground mt-2">
                          Logged: {formatIST(a.outcome_entered_at)}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export default function Scorecard() {
  const { data: status } = useGetSystemStatus();
  const markets = status?.markets || ["TSR20", "EURUSD"];
  const [activeMarket, setActiveMarket] = useState(markets[0]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6 mt-4">
        <div className="flex justify-between items-end border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">MODEL SCORECARD</h1>
            <p className="text-muted-foreground text-sm">Track predictions against reality to calibrate the analysis model.</p>
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

        <MarketScorecard key={activeMarket} market={activeMarket} />
      </div>
    </Layout>
  );
}
