import { MARKETS } from "@/lib/markets";
import { cn } from "@/lib/utils";

export function MarketTabs({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex items-center gap-1">
      {MARKETS.map((m) => (
        <button
          key={m.code}
          onClick={() => onChange(m.code)}
          className={cn(
            "kicker text-xs px-3.5 py-1.5 border-b-2 -mb-px transition-colors",
            value === m.code ? "border-accent text-accent" : "border-transparent text-text-dim hover:text-text"
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
