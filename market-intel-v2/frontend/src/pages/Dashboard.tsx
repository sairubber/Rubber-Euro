import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Newspaper, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import { useNow, useReveal } from "@/lib/hooks";
import { VideoHero } from "@/components/VideoHero";
import { FeatureCard, PhotoTile, TextRow, ThumbRow } from "@/components/NewsCards";
import { CategoriesPanel, SupplyRiskPanel, TrendingCountriesPanel } from "@/components/PortalPanels";
import { FeedRow } from "@/components/FeedRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FeedSkeleton, LeadSkeleton } from "@/components/ui/Skeleton";
import { cn, formatIST } from "@/lib/utils";
import type { NewsArticleRecord } from "@/lib/types";

function fmtUSD(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
}

/** Compact stat tile, mirroring the market-data cards on the reference
 * layouts — a number, its direction, and what it measures. */
function StatTile({
  label,
  value,
  changePct,
  sub,
  tone,
}: {
  label: string;
  value: string;
  changePct: number | null;
  sub: string;
  tone: "tsr20" | "eurusd";
}) {
  const up = (changePct ?? 0) > 0;
  const toneText = tone === "tsr20" ? "text-tsr20" : "text-eurusd";
  const toneBg = tone === "tsr20" ? "bg-tsr20-dim" : "bg-eurusd-dim";
  return (
    <div className={cn("p-3 sm:p-4 flex flex-col justify-between min-w-0", toneBg)}>
      <p className={cn("kicker text-[9px] truncate", toneText)}>{label}</p>
      <p className="num text-lg sm:text-xl font-bold text-text mt-1.5 truncate">{value}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        {changePct !== null && (
          <span className={cn("num text-[10px] flex items-center gap-0.5", up ? "text-bull" : "text-bear")}>
            {up ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {up ? "+" : ""}
            {changePct}%
          </span>
        )}
        <span className="kicker text-[8px] text-text-faint truncate">{sub}</span>
      </div>
    </div>
  );
}


export default function Dashboard() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  useNow();
  const gridRef = useReveal();
  const wireRef = useReveal();

  const latestQueries = useQueries({
    queries: MARKETS.map((m) => ({
      queryKey: ["latest-news", m.code],
      queryFn: () => api.getLatestNews(m.code),
      refetchInterval: 60_000,
      retry: false,
    })),
  });

  const historyQueries = useQueries({
    queries: MARKETS.map((m) => ({
      queryKey: ["news-history", m.code],
      queryFn: () => api.getNewsHistory(m.code, { limit: 24 }),
      refetchInterval: 60_000,
    })),
  });

  const { data: balance } = useQuery({ queryKey: ["trade-balance"], queryFn: api.getTradeBalance });
  const { data: outlook } = useQuery({ queryKey: ["outlook"], queryFn: api.getMarketOutlook });

  const anyLoading = latestQueries.some((q) => q.isLoading);
  const records = latestQueries
    .map((q) => (q.data as NewsArticleRecord | undefined) ?? null)
    .filter((r): r is NewsArticleRecord => !!r)
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

  const hero = records[0];

  const allFeed: NewsArticleRecord[] = historyQueries
    .flatMap((q) => (q.data as NewsArticleRecord[] | undefined) ?? [])
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .filter((item) => item.id !== hero?.id);

  // Image-led slots get image-bearing stories first. Only a minority of
  // sources expose an og:image (see README), so picking purely by recency
  // left the visual slots as mostly fallback plates. Recency still decides
  // order within each group, and text-only slots take whatever is left —
  // they lose nothing by having no picture.
  const imaged = allFeed.filter((a) => a.image_url);
  const plain = allFeed.filter((a) => !a.image_url);
  const visualQueue = [...imaged, ...plain];

  const photoPair = visualQueue.slice(0, 2);
  const secondFeature = visualQueue[2];
  const usedVisual = new Set([...photoPair, secondFeature].filter(Boolean).map((a) => a!.id));

  const remaining = allFeed.filter((a) => !usedVisual.has(a.id));
  const thumbRows = remaining.slice(0, 6);
  const textRows = remaining.slice(6, 12);
  const wire = remaining.slice(12, 30);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.refreshNews();
      setTimeout(() => {
        MARKETS.forEach((m) => {
          queryClient.invalidateQueries({ queryKey: ["latest-news", m.code] });
          queryClient.invalidateQueries({ queryKey: ["news-history", m.code] });
        });
        setRefreshing(false);
      }, 8_000);
    } catch {
      setRefreshing(false);
    }
  }

  if (anyLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 space-y-5">
          <LeadSkeleton />
          <FeedSkeleton rows={5} />
        </div>
        <div className="lg:col-span-4">
          <FeedSkeleton rows={5} />
        </div>
      </div>
    );
  }

  if (!hero) {
    return (
      <EmptyState
        icon={Newspaper}
        title="No news scraped yet"
        description="The desk pulls real headlines continuously — check back shortly, or refresh now."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Desk video: full width, top of page ─────────────────────────── */}
      <VideoHero />

      {/* ── Row 1: lead feature | photo pair + thumb list ───────────────── */}
      <div ref={gridRef} className="reveal grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <FeatureCard item={hero} imageClass="h-52 sm:h-64" />

        <div className="bg-bg-raised border border-border p-4 flex flex-col min-w-0">
          {photoPair.length > 0 && (
            <div className="grid grid-cols-2 gap-3 mb-1">
              {photoPair.map((item) => (
                <PhotoTile key={item.id} item={item} />
              ))}
            </div>
          )}
          {/* Two columns of thumbnail rows — this is the block that gives
              the page its density without another wall of plain text. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-5 flex-1">
            {thumbRows.map((item) => (
              <ThumbRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 2: dense text list | second feature ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-4 items-stretch">
        <div className="bg-bg-raised border border-border p-4 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
            {textRows.map((item) => (
              <TextRow key={item.id} item={item} />
            ))}
          </div>
        </div>

        {secondFeature && <FeatureCard item={secondFeature} imageClass="h-44 sm:h-52" />}
      </div>

      {/* ── Market bar ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
        <StatTile
          label="Supply · exports"
          value={balance ? fmtUSD(balance.supply_total_usd) : "—"}
          changePct={balance?.supply_change_pct ?? null}
          sub={balance?.supply_period ?? ""}
          tone="tsr20"
        />
        <StatTile
          label="Demand · imports"
          value={balance ? fmtUSD(balance.demand_total_usd) : "—"}
          changePct={balance?.demand_change_pct ?? null}
          sub={balance?.demand_period ?? ""}
          tone="eurusd"
        />
        <StatTile
          label="Producing countries"
          value={balance ? String(balance.supply_country_count) : "—"}
          changePct={null}
          sub="filed exports"
          tone="tsr20"
        />
        <StatTile
          label="Consuming countries"
          value={balance ? String(balance.demand_country_count) : "—"}
          changePct={null}
          sub="filed imports"
          tone="eurusd"
        />
      </div>

      {/* ── Utility panels ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
        <TrendingCountriesPanel />
        <CategoriesPanel feed={allFeed} />
        <SupplyRiskPanel />
      </div>

      {/* ── Wire ────────────────────────────────────────────────────────── */}
      {wire.length > 0 && (
        <div ref={wireRef} className="reveal border-t border-rule pt-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="kicker text-[11px] text-text-faint">Latest Wire</h2>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="kicker text-[10px] text-accent hover:opacity-80 disabled:opacity-50 active:scale-[0.97] transition-[opacity,transform] duration-300"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {/* CSS multi-column, NOT grid: grid rows cannot start until the
              tallest cell in the previous row ends, which left a gap under
              any story shorter than its row-mate. */}
          <div className="columns-1 xl:columns-2 xl:gap-x-10">
            {wire.map((item) => (
              <div key={item.id} className="break-inside-avoid">
                <FeedRow item={item} />
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="kicker text-[9px] text-text-faint text-center pt-2">
        Lead updated {formatIST(hero.published_at)} · every story links to its original publisher
        <ExternalLink size={9} className="inline ml-1 -mt-0.5" />
      </p>
    </div>
  );
}
