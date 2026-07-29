import { useId, useMemo } from "react";

/** Tiny animated sparkline — the one implementation every compact card
 * shares (vessel trends, port activity, grade strips). Draw-in line, soft
 * gradient area, breathing latest point. Pure CSS motion, reduced-motion
 * aware, no chart library. */
export function Sparkline({
  values,
  color = "#2f6b4f",
  height = 22,
  label,
}: {
  values: number[];
  color?: string;
  height?: number;
  label: string;
}) {
  const W = 100;
  const H = 22;
  const gradId = useId().replace(/:/g, "");

  const { d, area, last } = useMemo(() => {
    if (values.length < 2) return { d: "", area: "", last: null as { cx: number; cy: number } | null };
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const step = W / (values.length - 1);
    const pts = values.map((v, i) => [i * step, H - ((v - min) / span) * (H - 2) - 1] as const);
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return {
      d: line,
      area: `${line} L${W},${H} L0,${H} Z`,
      last: { cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1] },
    };
  }, [values]);

  if (!d) return null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path key={`a-${values.length}-${values[values.length - 1]}`} d={area} fill={`url(#${gradId})`} className="chart-fade-up" />
      <path
        key={`l-${values.length}-${values[values.length - 1]}`}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.3}
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        className="chart-draw"
      />
      {last && <circle cx={last.cx} cy={last.cy} r={2.5} fill={color} className="chart-pulse" />}
    </svg>
  );
}
