import { useEffect, useState } from "react";
import { useGetLatestAnalysis, useGetSystemStatus } from "@workspace/api-client-react";
import { AnalysisCard } from "@/components/AnalysisCard";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";

function MarketPanel({ market }: { market: string }) {
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  
  // Auto-poll every 60 seconds
  const { data: analysis, isLoading, refetch, isRefetching } = useGetLatestAnalysis(market, {
    query: {
      enabled: !!market,
      refetchInterval: 60000,
      queryKey: [market, 'latest']
    }
  });

  useEffect(() => {
    if (!isRefetching) {
      setLastRefreshed(new Date());
    }
  }, [isRefetching]);

  if (isLoading) {
    return (
      <div className="flex-1 min-w-[300px] flex flex-col gap-4">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex-1 min-w-[300px] flex items-center justify-center border border-dashed border-border rounded-lg p-12 text-center">
        <div>
          <div className="font-mono text-sm font-bold text-muted-foreground mb-2">{market}</div>
          <p className="text-sm text-muted-foreground">First analysis is running — check back in ~2 minutes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-[300px] flex flex-col h-full max-w-[800px] mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-mono font-bold tracking-tight">{market} LIVE DESK</h2>
        <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-2">
          {isRefetching ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <span>POLLED: {lastRefreshed.toLocaleTimeString()}</span>
          )}
        </div>
      </div>
      <AnalysisCard analysis={analysis} onRefresh={refetch} />
    </div>
  );
}

export default function Dashboard() {
  const { data: status } = useGetSystemStatus();
  const markets = status?.markets || ["TSR20", "EURUSD"];

  return (
    <Layout>
      <div className="h-full flex flex-col xl:flex-row gap-6">
        {markets.map((market) => (
          <MarketPanel key={market} market={market} />
        ))}
      </div>
    </Layout>
  );
}
