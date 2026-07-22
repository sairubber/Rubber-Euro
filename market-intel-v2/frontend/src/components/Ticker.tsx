import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import type { NewsArticleRecord } from "@/lib/types";

/** Newsroom ticker — the freshest headlines from both walls, scrolling under
 * the masthead. Content is duplicated once so the CSS loop is seamless.
 * Honors prefers-reduced-motion by standing still (it's still scrollable). */
export function Ticker() {
  const results = useQueries({
    queries: MARKETS.map((m) => ({
      queryKey: ["ticker", m.code],
      queryFn: () => api.getNewsHistory(m.code, { limit: 6 }),
      refetchInterval: 120_000,
      staleTime: 60_000,
    })),
  });

  const items: NewsArticleRecord[] = results
    .flatMap((r) => r.data ?? [])
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, 10);

  if (items.length === 0) return null;

  const strip = (
    <>
      {items.map((item) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-baseline gap-2 shrink-0 group"
        >
          <span className={item.market_tag === "TSR20" ? "kicker text-[9px] text-tsr20" : "kicker text-[9px] text-eurusd"}>
            {item.market_tag}
          </span>
          <span className="text-[12px] text-text-dim group-hover:text-text transition-colors whitespace-nowrap">
            {item.title}
          </span>
          <span className="text-text-faint select-none px-3" aria-hidden="true">
            ·
          </span>
        </a>
      ))}
    </>
  );

  return (
    <div className="border-t border-rule bg-bg-raised overflow-hidden" role="marquee" aria-label="Latest headlines">
      <div className="ticker-track flex items-center py-1.5 motion-reduce:overflow-x-auto">
        <div className="ticker-content flex items-center">{strip}</div>
        <div className="ticker-content flex items-center" aria-hidden="true">
          {strip}
        </div>
      </div>
    </div>
  );
}
