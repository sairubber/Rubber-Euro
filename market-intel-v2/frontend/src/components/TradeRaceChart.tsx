import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineFrame } from "@/lib/types";

/** Animated import/export chart — a bar-chart race across Comtrade reporting
 * periods. Bars interpolate via CSS transform/width transitions rather than a
 * per-frame redraw, so the motion is GPU-cheap and the whole thing is one
 * setInterval stepping the frame index.
 *
 * The value axis is fixed to the maximum across ALL frames, not per-frame —
 * otherwise every bar sits near 100% width and the animation shows reordering
 * without showing that volumes actually changed, which would misrepresent the
 * data.
 */

// Sequential ramps within one hue family per side, dark enough to hold their
// own on cream. Rank is already carried by bar length and vertical order, so
// the ramp only has to keep adjacent bars distinguishable.
const SUPPLY_COLORS = ["#2f6b4f", "#3d8060", "#4d9472", "#5da885", "#6fbc98"];
const DEMAND_COLORS = ["#2b4c7e", "#365f97", "#4272af", "#5086c6", "#619bdb"];

function formatUSD(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${(value / 1e3).toFixed(0)}K`;
}

function formatPeriod(period: string): string {
  if (period.length === 6) {
    const y = period.slice(0, 4);
    const m = Number(period.slice(4, 6));
    const name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
    return `${name} ${y}`;
  }
  return period;
}

export function TradeRaceChart({ frames }: { frames: TimelineFrame[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [side, setSide] = useState<"supply" | "demand">("supply");
  const timer = useRef<number | null>(null);

  // One shared ceiling across every frame and both sides, so bar lengths mean
  // the same thing throughout the animation.
  const maxValue = useMemo(() => {
    let max = 0;
    for (const f of frames) {
      for (const e of [...f.supply, ...f.demand]) {
        if (e.value_usd > max) max = e.value_usd;
      }
    }
    return max || 1;
  }, [frames]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => {
        if (i >= frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 900);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, frames.length]);

  if (frames.length === 0) return null;

  const frame = frames[Math.min(index, frames.length - 1)];
  const rows = side === "supply" ? frame.supply : frame.demand;
  const palette = side === "supply" ? SUPPLY_COLORS : DEMAND_COLORS;
  const atEnd = index >= frames.length - 1;

  function restart() {
    setIndex(0);
    setPlaying(true);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => setSide("supply")}
            className={cn(
              "kicker text-[10px] px-2.5 py-1 border transition-colors duration-300",
              side === "supply" ? "border-tsr20/50 text-tsr20 bg-tsr20/10" : "border-border-subtle text-text-faint hover:text-text-dim"
            )}
          >
            Supply · Exports
          </button>
          <button
            onClick={() => setSide("demand")}
            className={cn(
              "kicker text-[10px] px-2.5 py-1 border transition-colors duration-300",
              side === "demand" ? "border-eurusd/50 text-eurusd bg-eurusd/10" : "border-border-subtle text-text-faint hover:text-text-dim"
            )}
          >
            Demand · Imports
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex flex-col items-end leading-tight">
            <span className="num text-2xl font-bold text-text tabular-nums">{formatPeriod(frame.period)}</span>
            {atEnd && (
              <span className="kicker text-[8px] text-text-faint">newest fully-filed period</span>
            )}
          </span>
          <button
            onClick={() => (atEnd ? restart() : setPlaying((p) => !p))}
            className="kicker text-[10px] text-accent flex items-center gap-1.5 hover:opacity-80 active:scale-[0.97] transition-[opacity,transform] duration-300"
          >
            {atEnd ? (
              <>
                <RotateCcw size={12} /> Replay
              </>
            ) : playing ? (
              <>
                <Pause size={12} /> Pause
              </>
            ) : (
              <>
                <Play size={12} /> Play
              </>
            )}
          </button>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={frames.length - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false);
          setIndex(Number(e.target.value));
        }}
        aria-label="Scrub through reporting periods"
        className="w-full mb-5 accent-accent cursor-pointer"
      />

      <div className="space-y-1.5" style={{ minHeight: `${Math.max(rows.length, 6) * 34}px` }}>
        {rows.map((row, i) => (
          <div key={row.country} className="flex items-center gap-3">
            <span className="text-[12px] text-text-dim w-28 shrink-0 truncate text-right">{row.country}</span>
            <div className="flex-1 h-6 bg-surface/50 relative overflow-hidden">
              <div
                className="h-full transition-[width] duration-[850ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
                style={{
                  width: `${Math.max((row.value_usd / maxValue) * 100, 0.5)}%`,
                  backgroundColor: palette[i % palette.length],
                  opacity: 0.85,
                }}
              />
            </div>
            <span className="num text-[11px] text-text-faint w-20 shrink-0 tabular-nums">{formatUSD(row.value_usd)}</span>
          </div>
        ))}
      </div>

      <p className="kicker text-[9px] text-text-faint mt-4">
        HS 4001 natural rubber · UN Comtrade customs filings · bar length is share of the largest value across all periods shown
      </p>
    </div>
  );
}
