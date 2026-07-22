import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("border border-border-subtle bg-surface", className)}>
      {children}
    </div>
  );
}

export function NoticeBox({
  tone,
  children,
}: {
  tone: "amber" | "bear";
  children: ReactNode;
}) {
  const toneClasses = tone === "amber" ? "bg-amber-dim/60 border-amber/25 text-amber" : "bg-bear-dim/60 border-bear/25 text-bear";
  return <div className={cn("border px-4 py-3 text-sm leading-relaxed", toneClasses)}>{children}</div>;
}
