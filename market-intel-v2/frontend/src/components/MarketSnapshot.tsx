import type { NewsArticleRecord } from "@/lib/types";

export function MarketSnapshot({
  label,
  record,
  isLoading,
}: {
  label: string;
  record: NewsArticleRecord | null;
  isLoading: boolean;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between mb-1.5">
        <span className="kicker text-[10px] text-text-faint">{label}</span>
        {record?.source_name && <span className="kicker text-[10px] text-text-faint">{record.source_name}</span>}
      </div>

      {isLoading && <p className="text-xs text-text-faint">Loading…</p>}
      {!isLoading && !record && <p className="text-xs text-text-faint">No news yet.</p>}
      {record && (
        <p className="text-sm text-text group-hover:text-accent transition-colors leading-snug line-clamp-2">{record.title}</p>
      )}
    </>
  );

  if (!record) {
    return <div className="block py-3.5 border-b border-border-subtle last:border-0">{content}</div>;
  }

  return (
    <a
      href={record.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block py-3.5 border-b border-border-subtle last:border-0 group"
    >
      {content}
    </a>
  );
}
