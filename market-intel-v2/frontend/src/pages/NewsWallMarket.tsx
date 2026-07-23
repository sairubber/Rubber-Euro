import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ExternalLink, Newspaper, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import { useNow } from "@/lib/hooks";
import { AnimatedHeadline } from "@/components/AnimatedHeadline";
import { FeedRow } from "@/components/FeedRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FeedSkeleton, LeadSkeleton } from "@/components/ui/Skeleton";
import { marketTone, Tag } from "@/components/ui/Badge";
import { cn, relativeTime, formatIST } from "@/lib/utils";
import type { NewsArticleRecord, NewsCategory } from "@/lib/types";

const CATEGORIES: { value: NewsCategory | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "headline", label: "Headlines" },
  { value: "trade", label: "Trade" },
  { value: "disruption", label: "Disruption" },
];

export default function NewsWallMarket() {
  const { market: marketParam } = useParams<{ market: string }>();
  const market = (marketParam ?? "").toUpperCase();
  const marketInfo = MARKETS.find((m) => m.code === market);
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<NewsCategory | undefined>(undefined);
  const [country, setCountry] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [newStories, setNewStories] = useState(0);
  const newestSeenId = useRef<number | null>(null);
  useNow(); // keeps every "Xm ago" on the page honest while the tab sits open

  const { data: latest } = useQuery({
    queryKey: ["latest-news", market],
    queryFn: () => api.getLatestNews(market),
    enabled: !!marketInfo,
    retry: false,
    refetchInterval: 60_000,
  });

  const { data: feed, isLoading } = useQuery({
    queryKey: ["news-wall", market, category],
    queryFn: () => api.getNewsHistory(market, { limit: 60, category }),
    enabled: !!marketInfo,
    refetchInterval: 60_000,
  });

  // "N new stories" pill: compare the newest id across refetches of the
  // unfiltered wall so background scrapes surface visibly instead of the
  // list silently reshuffling under the reader.
  useEffect(() => {
    if (!feed || feed.length === 0 || category) return;
    const newestId = feed[0].id;
    if (newestSeenId.current === null) {
      newestSeenId.current = newestId;
      return;
    }
    if (newestId !== newestSeenId.current) {
      const count = feed.findIndex((i) => i.id === newestSeenId.current);
      setNewStories(count === -1 ? feed.length : count);
    }
  }, [feed, category]);

  function acknowledgeNewStories() {
    if (feed && feed.length > 0) newestSeenId.current = feed[0].id;
    setNewStories(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Reset per-market state when switching walls.
  useEffect(() => {
    newestSeenId.current = null;
    setNewStories(0);
    setCountry(undefined);
    setSearch("");
  }, [market]);

  const countries = useMemo(() => {
    if (!feed) return [];
    const counts = new Map<string, number>();
    for (const item of feed) {
      if (item.country) counts.set(item.country, (counts.get(item.country) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [feed]);

  const filtered = useMemo(() => {
    let items: NewsArticleRecord[] = feed ?? [];
    if (country) items = items.filter((i) => i.country === country);
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.source_name.toLowerCase().includes(q)
      );
    }
    return items;
  }, [feed, country, search]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.refreshNews();
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["latest-news", market] });
        queryClient.invalidateQueries({ queryKey: ["news-wall", market] });
        setRefreshing(false);
      }, 8_000);
    } catch {
      setRefreshing(false);
    }
  }

  if (!marketInfo) {
    return <EmptyState title="Unknown market" description="Valid markets: TSR20, EURUSD." />;
  }

  const isFiltering = !!search.trim() || !!country;
  const showLead = !category && !isFiltering && latest;
  const restOfFeed = showLead ? filtered.filter((item) => item.id !== latest?.id) : filtered;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {newStories > 0 && (
        <button
          onClick={acknowledgeNewStories}
          className="rise-in fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-accent text-bg kicker text-[10px] font-semibold px-4 py-2 shadow-lg hover:opacity-90 transition-opacity"
        >
          <ArrowUp size={12} /> {newStories} new {newStories === 1 ? "story" : "stories"}
        </button>
      )}

      <header className="text-center border-b border-rule pb-6">
        <p className={cn("kicker text-[10px] mb-3", market === "TSR20" ? "text-tsr20" : "text-eurusd")}>News Wall · Live</p>
        <AnimatedHeadline text={marketInfo.label} className="text-4xl md:text-5xl font-bold text-text justify-center" />
        <p className="text-sm text-text-dim mt-3 rise-in" style={{ animationDelay: "250ms" }}>
          Real-time real news for this market only — nothing mixed in from the other side.
        </p>

        <div className="flex flex-col items-center gap-3 mt-4">
          <div className="inline-flex items-center gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.label}
                onClick={() => setCategory(c.value)}
                className={cn(
                  "kicker text-[10px] px-2.5 py-1 border transition-colors",
                  category === c.value ? "border-accent/40 text-accent bg-accent/10" : "border-border-subtle text-text-faint hover:text-text-dim"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="relative w-full max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${marketInfo.label} stories, sources…`}
              className="w-full bg-surface border border-border-subtle focus:border-accent/50 outline-none text-[13px] text-text placeholder:text-text-faint pl-9 pr-8 py-2 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {countries.length > 1 && (
            <div className="flex items-center justify-center gap-1 flex-wrap">
              <button
                onClick={() => setCountry(undefined)}
                className={cn(
                  "kicker text-[9px] px-2 py-0.5 border transition-colors",
                  !country ? "border-accent/40 text-accent" : "border-border-subtle text-text-faint hover:text-text-dim"
                )}
              >
                All countries
              </button>
              {countries.map(([name, count]) => (
                <button
                  key={name}
                  onClick={() => setCountry(country === name ? undefined : name)}
                  className={cn(
                    "kicker text-[9px] px-2 py-0.5 border transition-colors",
                    country === name ? "border-accent/40 text-accent bg-accent/10" : "border-border-subtle text-text-faint hover:text-text-dim"
                  )}
                >
                  {name} <span className="opacity-60">{count}</span>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="kicker text-[10px] text-accent hover:opacity-80 disabled:opacity-50 transition-opacity"
          >
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </header>

      {isLoading && (
        <div className="space-y-8">
          <LeadSkeleton />
          <div className="pt-6 border-t border-rule">
            <FeedSkeleton rows={7} />
          </div>
        </div>
      )}

      {!isLoading && showLead && latest && (
        <div className="rise-in">
          <Tag tone="amber" className="mb-3 inline-block">
            Leading Now
          </Tag>
          <a href={latest.url} target="_blank" rel="noopener noreferrer" className="group block">
            <AnimatedHeadline
              as="h2"
              text={latest.title}
              baseDelayMs={150}
              className="text-3xl md:text-[2.6rem] font-bold leading-[1.1] text-text group-hover:text-accent transition-colors duration-500"
            />
          </a>
          {latest.description && <p className="text-[15px] text-text-dim mt-3 leading-relaxed">{latest.description}</p>}
          <div className="flex items-center justify-between mt-3">
            <p className="kicker text-[11px] text-text-faint" title={formatIST(latest.published_at)}>
              {latest.source_name} · {relativeTime(latest.published_at)}
            </p>
            <a href={latest.url} target="_blank" rel="noopener noreferrer" className="kicker text-[11px] text-accent hover:underline flex items-center gap-1">
              Read full story <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}

      {!isLoading && (
        <div className={cn(showLead && latest ? "pt-6 border-t border-rule" : "")}>
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="kicker text-[11px] text-text-faint">
              {isFiltering ? "Matching Stories" : category ? CATEGORIES.find((c) => c.value === category)?.label : "The Rest of the Wall"}
            </h2>
            {isFiltering && (
              <span className="kicker text-[10px] text-text-faint">
                {filtered.length} {filtered.length === 1 ? "match" : "matches"}
              </span>
            )}
          </div>
          {restOfFeed.length === 0 && !showLead && (
            isFiltering ? (
              <EmptyState
                icon={Search}
                title="No matches on the wall"
                description="Try a shorter search, another country, or clear the filters — new stories land continuously."
              />
            ) : (
              <EmptyState
                icon={Newspaper}
                title="No news scraped yet"
                description="The desk pulls real headlines continuously — check back in a few minutes, or refresh now."
              />
            )
          )}
          {restOfFeed.length > 0 && (
            /* Compact rows: uniform height, so a plain two-column grid aligns
               cleanly. The full-bullet reading of any story is one click away
               on the publisher page; the lead above already carries bullets. */
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-10">
              {restOfFeed.map((item) => (
                <FeedRow key={item.id} item={item} compact />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
