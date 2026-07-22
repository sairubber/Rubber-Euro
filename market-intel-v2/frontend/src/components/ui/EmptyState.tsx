import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  loading,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 border border-dashed border-border">
      {loading ? (
        <Loader2 className="animate-spin text-accent mb-3" size={20} />
      ) : Icon ? (
        <Icon className="text-text-faint mb-3" size={20} />
      ) : null}
      <p className="headline text-lg text-text">{title}</p>
      {description && <p className="text-xs mt-1.5 max-w-sm text-text-faint">{description}</p>}
    </div>
  );
}
