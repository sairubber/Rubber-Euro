import { useGetAnalysisHistory, useGetSystemStatus } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatIST } from "@/lib/utils";
import { Link } from "wouter";
import { useState } from "react";
import { ArrowRight } from "lucide-react";

function MarketHistory({ market }: { market: string }) {
  const { data: history, isLoading } = useGetAnalysisHistory(market, {
    query: { enabled: !!market, queryKey: [market, 'history'] }
  });

  if (isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  if (!history || history.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground text-sm font-mono">
        No analysis history for {market}.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="font-mono text-[10px]">DATE</TableHead>
            <TableHead className="font-mono text-[10px]">HEADLINE</TableHead>
            <TableHead className="font-mono text-[10px]">MODE</TableHead>
            <TableHead className="font-mono text-[10px]">CONVICTION</TableHead>
            <TableHead className="font-mono text-[10px] text-right">ACTION</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((record) => (
            <TableRow key={record.id} className="group cursor-pointer">
              <TableCell className="font-mono text-xs whitespace-nowrap">
                {formatIST(record.created_at)}
              </TableCell>
              <TableCell className="font-medium text-sm max-w-[400px] truncate">
                {record.headline || "Regular Market Update"}
              </TableCell>
              <TableCell>
                <Badge variant={record.run_mode === "delta" ? "secondary" : "outline"} className="font-mono text-[9px] uppercase">
                  {record.run_mode}
                </Badge>
              </TableCell>
              <TableCell>
                {record.conviction && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {record.conviction}/10
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Link href={`/analysis/${record.id}`} className="inline-flex items-center text-primary text-xs font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                  VIEW FULL <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function Archive() {
  const { data: status } = useGetSystemStatus();
  const markets = status?.markets || ["TSR20", "EURUSD"];
  const [activeMarket, setActiveMarket] = useState(markets[0]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6 mt-4">
        <div className="flex justify-between items-end border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">ARCHIVE</h1>
            <p className="text-muted-foreground text-sm">Historical record of all past analyses.</p>
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

        <MarketHistory key={activeMarket} market={activeMarket} />
      </div>
    </Layout>
  );
}
