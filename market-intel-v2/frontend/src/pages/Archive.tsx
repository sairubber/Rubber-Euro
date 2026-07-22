import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import { MarketTabs } from "@/components/MarketTabs";
import { FeedRow } from "@/components/FeedRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type { NewsCategory } from "@/lib/types";

const CATEGORIES: { value: NewsCategory | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "headline", label: "Headlines" },
  { value: "trade", label: "Trade" },
  { value: "disruption", label: "Disruption" },
];

export default function Archive() {
  const [market, setMarket] = useState<string>(MARKETS[0].code);
  const [category, setCategory] = useState<NewsCategory | undefined>(undefined);

  const { data, isLoading } = useQuery({
    queryKey: ["news-archive", market, category],
    queryFn: () => api.getNewsHistory(market, { limit: 60, category }),
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Full Record</p>
        <h1 className="headline text-4xl font-bold text-text">Archive</h1>
        <p className="text-sm text-text-dim mt-2">Every real story this desk has scraped.</p>
        <div className="flex flex-col items-center gap-3 mt-4">
          <MarketTabs value={market} onChange={setMarket} />
          <div className="inline-flex items-center gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.label}
                onClick={() => setCategory(c.value)}
                className={cn(
                  "kicker text-[10px] px-2.5 py-1 border",
                  category === c.value ? "border-accent/40 text-accent bg-accent/10" : "border-border-subtle text-text-faint hover:text-text-dim"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isLoading && <EmptyState loading title="Loading archive…" />}
      {!isLoading && (!data || data.length === 0) && (
        <EmptyState title="No news yet" description="Past stories for this market will appear here once the scheduler has scraped some." />
      )}
      {data && data.length > 0 && (
        <div>
          {data.map((item) => (
            <FeedRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
