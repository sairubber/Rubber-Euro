import { useState } from "react";
import { ExternalLink, Languages } from "lucide-react";
import { marketTone, Tag } from "@/components/ui/Badge";
import { CredibilityBadge } from "@/components/ui/CredibilityBadge";
import { relativeTime } from "@/lib/utils";
import type { NewsArticleRecord } from "@/lib/types";

/**
 * One story row.
 *
 * `compact` (default off) is the scannable-index variant used in the dense
 * Overview wire and multi-column lists: fixed-height thumbnail slot, headline,
 * one line of context, meta. It never renders bullets — bullets have 0-4
 * items, which made rows swing between 60px and 340px and read as unstructured
 * both in the wire and on the market walls.
 *
 * The full variant (compact=false) keeps the verbatim key-point bullets, for
 * the single-column reading view on each market wall where uneven height is
 * expected and fine.
 */
export function FeedRow({ item, compact = false }: { item: NewsArticleRecord; compact?: boolean }) {
  const keyPoints = item.key_points ?? [];
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!item.image_url && !imageFailed;
  const isTSR = item.market_tag === "TSR20";

  const hoverRule = isTSR ? "hover:border-l-tsr20" : "hover:border-l-eurusd";
  const bulletColor = isTSR ? "text-tsr20" : "text-eurusd";

  // Uniform media slot: real thumbnail, or a market-tinted plate. Keeping the
  // slot a fixed size regardless of whether an image exists is what makes the
  // rows line up instead of jumping.
  const thumb = (
    <div className={`shrink-0 overflow-hidden border border-border ${compact ? "w-16 h-16" : "w-24 h-20"}`}>
      {showImage ? (
        <img
          src={item.image_url!}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="w-full h-full object-cover bg-surface"
        />
      ) : (
        <div className={`w-full h-full flex items-center justify-center ${isTSR ? "bg-tsr20-dim" : "bg-eurusd-dim"}`}>
          <span className={`kicker text-[9px] font-semibold opacity-45 ${bulletColor}`}>{item.market_tag}</span>
        </div>
      )}
    </div>
  );

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex items-start gap-3 py-3 border-b border-border-subtle last:border-0 border-l-2 border-l-transparent ${hoverRule} hover:bg-surface/40 hover:pl-3 transition-[color,background-color,border-color,padding] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]`}
    >
      {thumb}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Tag tone={marketTone(item.market_tag)}>{item.market_tag}</Tag>
          {item.source_name && <span className="kicker text-[10px] text-text-faint truncate max-w-[140px]">{item.source_name}</span>}
          <CredibilityBadge credibility={item.credibility} />
          {item.country && (
            <span className="kicker text-[9px] text-text-faint border border-border-subtle px-1.5 py-px">{item.country}</span>
          )}
          {item.original_language && (
            <span className="kicker text-[9px] text-text-faint flex items-center gap-1" title={`Machine-translated from ${item.original_language}`}>
              <Languages size={10} /> translated
            </span>
          )}
        </div>

        <p className={`text-text group-hover:text-accent transition-colors leading-snug ${compact ? "text-[14px] line-clamp-2" : "text-[15px]"}`}>
          {item.title}
        </p>

        {compact ? (
          // One line of context, clamped — keeps every row the same height.
          (keyPoints[0] || item.description) && (
            <p className="text-xs text-text-faint leading-relaxed mt-1 line-clamp-1">{keyPoints[0] || item.description}</p>
          )
        ) : keyPoints.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {keyPoints.map((point, i) => (
              <li key={i} className="flex gap-2 text-xs text-text-dim leading-relaxed">
                <span className={`${bulletColor} shrink-0 mt-[3px] text-[8px]`} aria-hidden="true">
                  ▪
                </span>
                <span className="min-w-0">{point}</span>
              </li>
            ))}
          </ul>
        ) : (
          item.description && <p className="text-xs text-text-faint leading-relaxed mt-1 line-clamp-2">{item.description}</p>
        )}
      </div>

      <div className="shrink-0 flex items-start gap-1.5 text-right">
        <p className="kicker text-[10px] text-text-faint mt-0.5" title={item.published_at}>
          {relativeTime(item.published_at)}
        </p>
        <ExternalLink size={11} className="text-text-faint group-hover:text-accent transition-colors shrink-0 mt-0.5" />
      </div>
    </a>
  );
}
