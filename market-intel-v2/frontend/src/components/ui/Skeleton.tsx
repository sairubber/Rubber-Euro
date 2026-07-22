import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-surface-hover animate-pulse motion-reduce:animate-none",
        className
      )}
    />
  );
}

/** Placeholder rows shaped like FeedRow — the page keeps its structure while
 * loading instead of collapsing into a spinner box. */
export function FeedSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-3.5 border-b border-border-subtle last:border-0">
          <div className="min-w-0 flex-1">
            <Bone className="h-2.5 w-24 mb-2.5" />
            <Bone className="h-4 w-4/5 mb-2" />
            <Bone className="h-3 w-3/5" />
          </div>
          <Bone className="h-2.5 w-12 shrink-0 mt-1" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for the lead-story slot. */
export function LeadSkeleton() {
  return (
    <div aria-hidden="true">
      <Bone className="h-2.5 w-20 mb-4" />
      <Bone className="h-8 w-full mb-2.5" />
      <Bone className="h-8 w-2/3 mb-4" />
      <Bone className="h-3.5 w-4/5 mb-2" />
      <Bone className="h-3.5 w-3/5" />
    </div>
  );
}
