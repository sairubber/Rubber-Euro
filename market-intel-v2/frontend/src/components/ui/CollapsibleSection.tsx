import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  right,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-rule pt-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-left group">
        <span className="kicker text-[11px] font-semibold text-text-dim group-hover:text-accent transition-colors flex items-center gap-2">
          <span className={cn("text-accent transition-transform inline-block", open && "rotate-90")}>▸</span>
          {title}
        </span>
        {right}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}
