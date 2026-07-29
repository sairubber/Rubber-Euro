import { useMemo } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GradeSeries } from "@/lib/types";

/** One grade's export series — an inline area/bar sparkline plus its latest
 * figure and top producers. Rendered as plain SVG rather than a chart
 * library: these are small multiples (four side by side), and four Recharts
 * instances cost far more than four <path> elements. */

const GRADE_COLORS: Record<string, string> = {
  "400122": "#2f6b4f", // TSR / TSNR — the TSR20 grade, house green
  "400121": "#9d6f1d", // RSS — smoked sheet amber
  "400110": "#2b4c7e", // Latex — milky blue
  "400129": "#8c4f73", // Cup lumps & other primary forms
};

function formatUSD(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
}

function formatTonnes(kg: number): string {
  const t = kg / 1000;
  if (t >= 1e6) return `${(t / 1e6).toFixed(2)}M t`;
  if (t >= 1e3) return `${(t / 1e3).toFixed(0)}k t`;
  return `${t.toFixed(0)} t`;
}

function formatPeriod(p: string): string {
  if (p.length === 6) {
    const m = Number(p.slice(4, 6));
    const name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
    return `${name} ${p.slice(2, 4)}`;
  }
  return p;
}

export function GradeChart({ series }: { series: GradeSeries }) {
  const color = GRADE_COLORS[series.hs_code] ?? "#9d6f1d";
  const points = series.points;

  const { path, area, bars } = useMemo(() => {
    const W = 100;
    const H = 32;
    if (points.length === 0) return { path: "", area: "", bars: [] };
    const max = Math.max(...points.map((p) => p.qty_kg), 1);
    const step = points.length > 1 ? W / (points.length - 1) : W;
    const coords = points.map((p, i) => {
      const x = points.length > 1 ? i * step : W / 2;
      const y = H - (p.qty_kg / max) * H;
      return [x, y] as const;
    });
    const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const filled = `${line} L${W},${H} L0,${H} Z`;
    const barW = Math.max(W / Math.max(points.length, 1) - 1, 1.5);
    return {
      path: line,
      area: filled,
      bars: points.map((p, i) => ({
        x: points.length > 1 ? i * step - barW / 2 : W / 2 - barW / 2,
        w: barW,
        h: (p.qty_kg / max) * H,
        period: p.period,
        qty: p.qty_kg,
      })),
    };
  }, [points]);

  const up = (series.qty_change_pct ?? 0) > 0;

  return (
    <div className="border border-border-subtle p-4">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <p className="kicker text-[10px] truncate" style={{ color }}>
            {series.grade}
          </p>
          <p className="kicker text-[9px] text-text-faint mt-0.5">HS {series.hs_code}</p>
        </div>
        {series.qty_change_pct !== null && (
          <span
            className={cn(
              "num text-[11px] flex items-center gap-1 shrink-0",
              up ? "text-bull" : series.qty_change_pct < 0 ? "text-bear" : "text-text-faint"
            )}
          >
            {up ? <TrendingUp size={11} /> : series.qty_change_pct < 0 ? <TrendingDown size={11} /> : null}
            {up ? "+" : ""}
            {series.qty_change_pct}%
          </span>
        )}
      </div>

      <p className="num text-xl font-bold text-text mt-2">{formatTonnes(series.latest_qty_kg)}</p>
      <p className="num text-[11px] text-text-dim">{formatUSD(series.latest_value_usd)}</p>
      <p className="kicker text-[9px] text-text-faint mt-0.5">
        {formatPeriod(series.latest_period)} · exports
      </p>

      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-full h-12 mt-3" role="img" aria-label={`${series.grade} export volume trend`}>
        <path d={area} fill={color} opacity={0.14} className="chart-fade-up" />
        <path d={path} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" pathLength={1} className="chart-draw" />
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={32 - b.h} width={b.w} height={b.h} fill={color} opacity={0.28}>
            <title>{`${formatPeriod(b.period)} — ${formatTonnes(b.qty)}`}</title>
          </rect>
        ))}
      </svg>
      <div className="flex justify-between kicker text-[8px] text-text-faint mt-1">
        <span>{formatPeriod(points[0]?.period ?? "")}</span>
        <span>{formatPeriod(points[points.length - 1]?.period ?? "")}</span>
      </div>

      {series.top_producers.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border-subtle">
          <p className="kicker text-[9px] text-text-faint mb-1.5">Top producers</p>
          {series.top_producers.slice(0, 4).map((p) => (
            <div key={p.country} className="flex items-baseline justify-between gap-2 py-0.5">
              <span className="text-[11px] text-text-dim truncate">{p.country}</span>
              <span className="num text-[10px] text-text-faint shrink-0">{formatTonnes(p.qty_kg)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
