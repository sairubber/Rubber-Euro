import { useState } from "react";
import { cn, relativeTime, formatIST } from "@/lib/utils";
import type { NewsArticleRecord } from "@/lib/types";

/** Card vocabulary for the front page.
 *
 * Three shapes, matching how a news portal actually ranks stories:
 *   FeatureCard — photo on top, category chip, big headline, source footer
 *   ThumbRow    — square thumbnail beside a two-line headline
 *   TextRow     — headline only, for the dense tail of the page
 *
 * All three share one rule: a story without an og:image never collapses its
 * media slot, it falls back to a market-tinted plate. Only a minority of our
 * sources expose an image, and a half-empty card grid reads as broken.
 */

function categoryLabel(item: NewsArticleRecord): string {
  if (item.category === "trade") return item.market_tag === "TSR20" ? "TRADE" : "POLICY";
  if (item.category === "disruption") return "DISRUPTION";
  return item.market_tag === "TSR20" ? "RUBBER" : "FOREX";
}

function Chip({ item, floating = false }: { item: NewsArticleRecord; floating?: boolean }) {
  const isTSR = item.market_tag === "TSR20";
  return (
    <span
      className={cn(
        "kicker text-[9px] font-semibold px-2 py-1 text-white inline-block",
        isTSR ? "bg-tsr20" : "bg-eurusd",
        floating && "absolute left-0 bottom-0"
      )}
    >
      {categoryLabel(item)}
    </span>
  );
}

function Media({
  item,
  className,
  children,
}: {
  item: NewsArticleRecord;
  className?: string;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const show = !!item.image_url && !failed;
  const isTSR = item.market_tag === "TSR20";

  return (
    <div className={cn("relative overflow-hidden bg-surface shrink-0", className)}>
      {show ? (
        <img
          src={item.image_url!}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105"
        />
      ) : (
        <div className={cn("w-full h-full flex items-center justify-center", isTSR ? "bg-tsr20-dim" : "bg-eurusd-dim")}>
          <span
            className={cn(
              "kicker text-[11px] font-semibold tracking-[0.2em] opacity-45",
              isTSR ? "text-tsr20" : "text-eurusd"
            )}
          >
            {item.market_tag}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

/** Lead card: photo, chip, headline, source + timestamp. */
export function FeatureCard({ item, imageClass = "h-52" }: { item: NewsArticleRecord; imageClass?: string }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-bg-raised border border-border hover:border-accent/50 transition-colors duration-300 p-4 h-full min-w-0"
    >
      <Media item={item} className={cn("w-full", imageClass)}>
        <Chip item={item} floating />
      </Media>

      <h3 className="headline text-xl sm:text-2xl font-bold text-text leading-tight mt-4 group-hover:text-accent transition-colors">
        {item.title}
      </h3>

      <div className="flex items-center gap-2.5 mt-auto pt-4">
        <span
          className={cn(
            "w-8 h-8 flex items-center justify-center kicker text-[9px] font-bold text-white shrink-0",
            item.market_tag === "TSR20" ? "bg-tsr20" : "bg-eurusd"
          )}
        >
          {(item.source_name || "?").slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block text-[12px] text-text truncate">{item.source_name || "Unattributed"}</span>
          <span className="block kicker text-[9px] text-text-faint" title={formatIST(item.published_at)}>
            {relativeTime(item.published_at)}
          </span>
        </span>
      </div>
    </a>
  );
}

/** Thumbnail + headline row, for the mixed right-hand block. */
export function ThumbRow({ item }: { item: NewsArticleRecord }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3 py-3 border-b border-border-subtle last:border-0 min-w-0"
    >
      <Media item={item} className="w-14 h-14 sm:w-16 sm:h-16" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-text leading-snug line-clamp-2 group-hover:text-accent transition-colors">
          {item.title}
        </span>
        <span className={cn("block kicker text-[8px] mt-1.5", item.market_tag === "TSR20" ? "text-tsr20" : "text-eurusd")}>
          {categoryLabel(item)}
        </span>
        <span className="block kicker text-[8px] text-text-faint mt-0.5">{relativeTime(item.published_at)}</span>
      </span>
    </a>
  );
}

/** Headline-only row for the dense two-column tail. */
export function TextRow({ item }: { item: NewsArticleRecord }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block py-4 border-b border-border-subtle last:border-0 min-w-0"
    >
      <span className="block text-[14px] text-text leading-snug line-clamp-2 group-hover:text-accent transition-colors">
        {item.title}
      </span>
      <span className={cn("block kicker text-[8px] mt-2", item.market_tag === "TSR20" ? "text-tsr20" : "text-eurusd")}>
        {categoryLabel(item)}
      </span>
      <span className="block kicker text-[8px] text-text-faint mt-0.5">{relativeTime(item.published_at)}</span>
    </a>
  );
}

/** Wide photo tile used as a pair at the top of the right-hand block. */
export function PhotoTile({ item }: { item: NewsArticleRecord }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden border border-border h-28 sm:h-32 min-w-0"
    >
      <Media item={item} className="absolute inset-0 w-full h-full" />
      <span className="absolute inset-0 bg-gradient-to-t from-[#0b0906]/85 via-[#0b0906]/25 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 p-2.5">
        <span className="block text-[11px] font-medium text-white leading-snug line-clamp-2">{item.title}</span>
      </span>
    </a>
  );
}
