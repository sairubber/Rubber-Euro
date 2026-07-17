import { useState } from "react";
import { useRunFlashAlert, useTriggerMarketRun } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Zap, AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FlashDesk() {
  const [headline, setHeadline] = useState("");
  const flashAlert = useRunFlashAlert();
  const triggerRun = useTriggerMarketRun();

  const handleRunFlash = () => {
    if (!headline.trim()) return;
    flashAlert.mutate({ data: { headline } });
  };

  const handleRunFull = (market: string) => {
    triggerRun.mutate({ market });
  };

  const result = flashAlert.data;
  const p = result?.payload;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6 mt-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> FLASH DESK
          </h1>
          <p className="text-muted-foreground text-sm">
            Input breaking news to rapidly assess impact and determine if a full market analysis is required.
          </p>
        </div>

        <div className="bg-card border border-border p-6 rounded-lg shadow-sm space-y-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
          <Textarea
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Paste breaking news headline or short report here..."
            className="font-mono text-sm bg-background border-border min-h-[120px]"
            disabled={flashAlert.isPending}
          />
          <div className="flex justify-end">
            <Button 
              onClick={handleRunFlash} 
              disabled={!headline.trim() || flashAlert.isPending}
              className="font-mono"
            >
              {flashAlert.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              EXECUTE FLASH ASSESSMENT
            </Button>
          </div>
        </div>

        {p && (
          <div className="bg-card border border-border rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden">
            <div className="bg-muted/30 border-b border-border p-4 flex items-center gap-3">
              <Badge variant={p.event_confirmed === "Yes" ? "default" : "outline"} className="font-mono text-[10px]">
                CONFIRMED: {p.event_confirmed}
              </Badge>
              <span className="font-mono text-xs font-bold">{p.affected_market}</span>
              <Badge variant="outline" className="font-mono text-[10px] ml-auto">
                SCORE: {p.conviction_score}/10
              </Badge>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <h3 className="font-mono text-xs text-muted-foreground mb-1 uppercase">Immediate Direction</h3>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-lg font-bold font-mono tracking-tight",
                    p.immediate_direction?.includes("Bullish") || p.immediate_direction?.includes("Up") ? "text-green-500" :
                    p.immediate_direction?.includes("Bearish") || p.immediate_direction?.includes("Down") ? "text-red-500" :
                    "text-gray-400"
                  )}>
                    {p.immediate_direction}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px] bg-background">
                    MAGNITUDE: {p.magnitude_estimate}
                  </Badge>
                </div>
              </div>

              <div>
                <h3 className="font-mono text-xs text-muted-foreground mb-2 uppercase">Mechanism</h3>
                <p className="text-sm font-medium">{p.one_line_mechanism}</p>
              </div>

              {p.requires_full_analysis === "Yes" && (
                <div className="bg-primary/10 border border-primary/30 p-4 rounded-md flex items-center justify-between mt-4">
                  <div className="flex items-center gap-3 text-primary">
                    <AlertTriangle className="w-5 h-5" />
                    <span className="text-sm font-mono font-bold">FULL ANALYSIS RECOMMENDED</span>
                  </div>
                  <Button 
                    onClick={() => handleRunFull(p.affected_market as string)}
                    disabled={triggerRun.isPending}
                    className="font-mono text-xs"
                  >
                    {triggerRun.isPending ? "TRIGGERING..." : "RUN NOW"} <ArrowRight className="w-3 h-3 ml-2" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
