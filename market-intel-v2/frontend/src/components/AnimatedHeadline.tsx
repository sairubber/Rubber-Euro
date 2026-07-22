import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** Kinetic typography: each word rises out of its own overflow mask with a
 * small stagger — the "wire dispatch arriving" moment. Keyed on the text so
 * a new lead story replays the reveal. Falls back to static text under
 * prefers-reduced-motion (handled in CSS). */
export function AnimatedHeadline({
  text,
  className,
  as: Tag = "h1",
  staggerMs = 45,
  baseDelayMs = 0,
}: {
  text: string;
  className?: string;
  as?: "h1" | "h2" | "span";
  staggerMs?: number;
  baseDelayMs?: number;
}) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  return (
    <Tag className={cn("headline", className)} key={text}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="mask-line">
          <span
            className="mask-rise"
            style={{ ["--stagger" as string]: `${baseDelayMs + i * staggerMs}ms` }}
          >
            {word}
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}
