import { useState } from "react";
import { cn, newsImageFallback, relativeTime } from "@/lib/utils";
import type { NewsArticleRecord } from "@/lib/types";

/** Image-backed story tile: photo fills the card, headline and category sit
 * over a bottom-weighted scrim. Used to build the front-page mosaic.
 *
 * Articles without an og:image fall back to a market-tinted plate rather
 * than collapsing — only a minority of our sources expose one, and a
 * half-empty mosaic looks broken.
 */
export function MosaicCard({
  item,
  size = "small",
}: {
  item: NewsArticleRecord;
  size?: "large" | "wide" | "small";
}) {
  const sources = [...(item.image_url ? [item.image_url] : []), newsImageFallback(item.title, 640, 480)];
  const [srcIdx, setSrcIdx] = useState(0);
  const showImage = srcIdx < sources.length;
  const isTSR = item.market_tag === "TSR20";

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden border border-border bg-surface h-full min-w-0"
    >
      {showImage ? (
        <img
          src={sources[srcIdx]}
          alt=""
          loading="lazy"
          onError={() => setSrcIdx((i) => i + 1)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105"
        />
      ) : (
        <div className={cn("absolute inset-0", isTSR ? "bg-tsr20-dim" : "bg-eurusd-dim")}>
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center kicker font-semibold tracking-[0.25em] opacity-25",
              size === "large" ? "text-5xl" : "text-2xl",
              isTSR ? "text-tsr20" : "text-eurusd"
            )}
          >
            {item.market_tag}
          </span>
        </div>
      )}

      {/* Scrim: bottom-weighted so the headline stays legible over any
          frame, while the top of the photo remains visible. */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0b0906] via-[#0b0906]/55 to-transparent" />

      <div className={cn("relative h-full flex flex-col justify-end", size === "large" ? "p-5 sm:p-6" : "p-4")}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span
            className={cn(
              "kicker text-[9px] font-semibold px-2 py-1 text-white",
              isTSR ? "bg-tsr20" : "bg-eurusd"
            )}
          >
            {item.market_tag}
          </span>
          {item.country && (
            <span className="kicker text-[9px] text-white/70 border border-white/25 px-1.5 py-0.5">{item.country}</span>
          )}
        </div>

        <h3
          className={cn(
            "headline font-bold text-white leading-tight group-hover:text-accent transition-colors duration-300",
            size === "large" ? "text-xl sm:text-3xl" : size === "wide" ? "text-lg sm:text-xl" : "text-sm sm:text-base"
          )}
        >
          {item.title}
        </h3>

        <div className="flex items-center justify-between gap-3 mt-3 kicker text-[9px] text-white/60">
          <span className="truncate">{item.source_name}</span>
          <span className="shrink-0">{relativeTime(item.published_at)}</span>
        </div>
      </div>
    </a>
  );
}
