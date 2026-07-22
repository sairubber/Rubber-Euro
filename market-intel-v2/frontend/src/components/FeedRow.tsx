import { useState } from "react";
import { ExternalLink, Languages } from "lucide-react";
import { marketTone, Tag } from "@/components/ui/Badge";
import { CredibilityBadge } from "@/components/ui/CredibilityBadge";
import { relativeTime } from "@/lib/utils";
import type { NewsArticleRecord } from "@/lib/types";

export function FeedRow({ item }: { item: NewsArticleRecord }) {
  // Defensive: a response missing key_points (an older cached payload, or a
  // future endpoint that forgets the field) must degrade to the description,
  // not throw and blank the entire page.
  const keyPoints = item.key_points ?? [];
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!item.image_url && !imageFailed;

  const hoverRule =
    item.market_tag === "TSR20"
      ? "hover:border-l-tsr20"
      : item.market_tag === "EURUSD"
        ? "hover:border-l-eurusd"
        : "hover:border-l-accent";
  const bulletColor = item.market_tag === "TSR20" ? "text-tsr20" : "text-eurusd";

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex items-start gap-3 py-3.5 border-b border-border-subtle last:border-0 border-l-2 border-l-transparent ${hoverRule} hover:bg-surface/40 hover:pl-3 transition-[color,background-color,border-color,padding] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]`}
    >
      {/* Thumbnail — the reference layouts anchor every list row with one,
          and it keeps rows that have no bullets from reading as bare text. */}
      {showImage && (
        <img
          src={item.image_url!}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="w-20 h-16 sm:w-24 sm:h-20 object-cover border border-border shrink-0 bg-surface"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Tag tone={marketTone(item.market_tag)}>{item.market_tag}</Tag>
          {item.source_name && <span className="kicker text-[10px] text-text-faint">{item.source_name}</span>}
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

        <p className="text-[15px] text-text group-hover:text-accent transition-colors leading-snug">{item.title}</p>

        {/* Key points are sentences lifted verbatim from the article — shown
            instead of the one-line description when we have them, because
            they carry the actual numbers a desk reads for. */}
        {keyPoints.length > 0 ? (
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
