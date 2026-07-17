import * as React from "react"
import { cn } from "@/lib/utils"

interface CollapsibleSectionProps {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  headerClassName?: string;
  badge?: React.ReactNode;
}

export function CollapsibleSection({ title, children, defaultOpen = false, className, headerClassName, badge }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className={cn("border border-border rounded-md overflow-hidden bg-card/50", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn("w-full flex items-center justify-between p-3 text-left font-mono text-sm hover:bg-accent/50 transition-colors", headerClassName)}
      >
        <div className="flex items-center gap-2 font-semibold">
          <span className="text-muted-foreground w-4 flex justify-center">
            {isOpen ? "▼" : "▶"}
          </span>
          {title}
        </div>
        {badge}
      </button>
      {isOpen && (
        <div className="p-4 border-t border-border/50 bg-background/50 text-sm">
          {children}
        </div>
      )}
    </div>
  );
}
