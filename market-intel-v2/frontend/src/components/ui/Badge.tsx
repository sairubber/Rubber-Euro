import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Tone = "neutral" | "bull" | "bear" | "amber" | "accent" | "tsr20" | "eurusd";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-text-dim",
  bull: "text-bull",
  bear: "text-bear",
  amber: "text-amber",
  accent: "text-accent",
  tsr20: "text-tsr20",
  eurusd: "text-eurusd",
};

/** Market-coded tone: TSR20 stories read latex-green, EUR/USD euro-blue —
 * the market of any story is legible from color alone, site-wide. */
export function marketTone(market: string): Tone {
  if (market === "TSR20") return "tsr20";
  if (market === "EURUSD") return "eurusd";
  return "accent";
}

export function Tag({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn("kicker text-[10px] font-semibold", TONE_TEXT[tone], className)}>{children}</span>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border border-border px-2 py-0.5 kicker text-[10px] font-medium whitespace-nowrap",
        TONE_TEXT[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function convictionTone(score: number): Tone {
  if (score <= 3) return "bear";
  if (score <= 6) return "amber";
  return "bull";
}

export function ConvictionBadge({ score }: { score: number | string }) {
  const n = typeof score === "number" ? score : parseFloat(score) || 0;
  const tone = convictionTone(n);
  return (
    <span className={cn("num flex items-baseline gap-1", TONE_TEXT[tone])}>
      <span className="text-2xl font-bold leading-none">{n}</span>
      <span className="text-[10px] text-text-faint">/10 conviction</span>
    </span>
  );
}
