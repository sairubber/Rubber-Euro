import { useMemo } from "react";

/** Small multi-series line chart as plain SVG — same reasoning as
 * GradeChart: a couple of <path> elements beat a chart-library instance for
 * these compact desk panels. Series may have gaps (undefined y) — the line
 * simply breaks there, it never interpolates a value nobody published. */

export interface DeskSeries {
  key: string;
  label: string;
  color: string;
  points: { x: string; y: number | undefined }[];
}

export function DeskLineChart({
  series,
  height = 180,
  zeroLine = false,
  unit = "",
}: {
  series: DeskSeries[];
  height?: number;
  zeroLine?: boolean;
  unit?: string;
}) {
  const W = 600;
  const H = 160;

  const { paths, min, max, xs } = useMemo(() => {
    const values = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v !== undefined);
    if (values.length === 0) return { paths: [], min: 0, max: 0, xs: [] as string[] };
    let lo = Math.min(...values, zeroLine ? 0 : Infinity);
    let hi = Math.max(...values, zeroLine ? 0 : -Infinity);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;

    const xLabels = series[0]?.points.map((p) => p.x) ?? [];
    const n = Math.max(xLabels.length - 1, 1);
    const toX = (i: number) => (i / n) * W;
    const toY = (v: number) => H - ((v - lo) / (hi - lo)) * H;

    const built = series.map((s) => {
      let d = "";
      let pen = false;
      s.points.forEach((p, i) => {
        if (p.y === undefined) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${toX(i).toFixed(1)},${toY(p.y).toFixed(1)} `;
        pen = true;
      });
      const dots = s.points
        .map((p, i) => (p.y === undefined ? null : { cx: toX(i), cy: toY(p.y), x: p.x, y: p.y }))
        .filter((d2): d2 is NonNullable<typeof d2> => d2 !== null);
      return { ...s, d, dots };
    });
    return { paths: built, min: lo, max: hi, xs: xLabels };
  }, [series, zeroLine]);

  if (paths.length === 0) {
    return <p className="text-[11px] text-text-faint py-8 text-center">Not enough overlapping data yet — the chart fills in as daily sheets accumulate.</p>;
  }

  const zeroY = H - ((0 - min) / (max - min)) * H;

  return (
    <div>
      <div className="flex items-center gap-4 mb-2 flex-wrap">
        {paths.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 kicker text-[9px] text-text-dim">
            <span className="inline-block w-3 h-0.5" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between num text-[9px] text-text-faint py-0.5 text-right shrink-0 w-12">
          <span>{max.toFixed(0)}{unit}</span>
          {zeroLine && min < 0 && max > 0 && <span>0</span>}
          <span>{min.toFixed(0)}{unit}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img">
          {zeroLine && min < 0 && max > 0 && (
            <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="currentColor" strokeDasharray="4 4" className="text-rule" strokeWidth={1} />
          )}
          {paths.map((s) => (
            <g key={s.key}>
              <path d={s.d} fill="none" stroke={s.color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
              {s.dots.map((d2, i) => (
                <circle key={i} cx={d2.cx} cy={d2.cy} r={5} fill="transparent">
                  <title>{`${d2.x} — ${s.label}: ${d2.y.toFixed(1)}${unit}`}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
      </div>
      <div className="flex justify-between kicker text-[8px] text-text-faint mt-1 pl-14">
        <span>{xs[0]}</span>
        <span>{xs[xs.length - 1]}</span>
      </div>
    </div>
  );
}
