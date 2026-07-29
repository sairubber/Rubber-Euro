import { useId, useMemo, useRef, useState } from "react";

/** Shared desk chart — plain SVG, no chart library.
 *
 * v2: lines draw themselves in (CSS pathLength trick), the first series gets
 * a soft gradient area, the freshest point breathes, and a hover crosshair
 * reads out every series at the nearest x. Series may have gaps (undefined
 * y) — the line breaks there, it never interpolates a value nobody
 * published. Animations are pure CSS and respect prefers-reduced-motion. */

export interface DeskSeries {
  key: string;
  label: string;
  color: string;
  points: { x: string; y: number | undefined }[];
}

interface Hover {
  idx: number;
  px: number;
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
  const gradId = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const { paths, min, max, xs, toX } = useMemo(() => {
    const values = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v !== undefined);
    if (values.length === 0)
      return { paths: [], min: 0, max: 0, xs: [] as string[], toX: (_i: number) => 0 };
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
    const toXFn = (i: number) => (i / n) * W;
    const toY = (v: number) => H - ((v - lo) / (hi - lo)) * H;

    const built = series.map((s, si) => {
      let d = "";
      let area = "";
      let pen = false;
      const drawnXs: number[] = [];
      s.points.forEach((p, i) => {
        if (p.y === undefined) {
          pen = false;
          return;
        }
        const px = toXFn(i);
        d += `${pen ? "L" : "M"}${px.toFixed(1)},${toY(p.y).toFixed(1)} `;
        drawnXs.push(px);
        pen = true;
      });
      // Gradient area under the FIRST series only — more would muddy overlaps.
      if (si === 0 && drawnXs.length > 0) {
        area = `${d} L${drawnXs[drawnXs.length - 1].toFixed(1)},${H} L${drawnXs[0].toFixed(1)},${H} Z`;
      }
      const last = [...s.points].reverse().find((p) => p.y !== undefined);
      const lastIdx = last ? s.points.lastIndexOf(last) : -1;
      return {
        ...s,
        d,
        area,
        lastDot: last && lastIdx >= 0 ? { cx: toXFn(lastIdx), cy: toY(last.y as number) } : null,
        yAt: (i: number) => {
          const v = s.points[i]?.y;
          return v === undefined ? null : { v, cy: toY(v) };
        },
      };
    });
    return { paths: built, min: lo, max: hi, xs: xLabels, toX: toXFn };
  }, [series, zeroLine]);

  if (paths.length === 0) {
    return <p className="text-[11px] text-text-faint py-8 text-center">Not enough overlapping data yet — the chart fills in as daily sheets accumulate.</p>;
  }

  const zeroY = H - ((0 - min) / (max - min)) * H;
  // Re-keying on the freshest x re-triggers the draw when new data lands.
  const drawKey = xs[xs.length - 1] ?? "k";

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const idx = Math.min(Math.max(Math.round(frac * (xs.length - 1)), 0), xs.length - 1);
    setHover({ idx, px: toX(idx) });
  };

  return (
    <div ref={wrapRef} className="relative">
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
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full cursor-crosshair"
          style={{ height }}
          role="img"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={paths[0].color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={paths[0].color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {zeroLine && min < 0 && max > 0 && (
            <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="currentColor" strokeDasharray="4 4" className="text-rule" strokeWidth={1} />
          )}
          {paths[0].area && <path key={`a-${drawKey}`} d={paths[0].area} fill={`url(#${gradId})`} className="chart-fade-up" />}
          {paths.map((s) => (
            <g key={s.key}>
              <path
                key={`${s.key}-${drawKey}`}
                d={s.d}
                fill="none"
                stroke={s.color}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                className="chart-draw"
              />
              {s.lastDot && (
                <>
                  <circle cx={s.lastDot.cx} cy={s.lastDot.cy} r={5} fill={s.color} className="chart-pulse" />
                  <circle cx={s.lastDot.cx} cy={s.lastDot.cy} r={2.2} fill={s.color} />
                </>
              )}
            </g>
          ))}
          {hover && (
            <>
              <line x1={hover.px} x2={hover.px} y1={0} y2={H} stroke="currentColor" strokeWidth={1} className="text-rule" strokeDasharray="2 3" />
              {paths.map((s) => {
                const pt = s.yAt(hover.idx);
                return pt ? <circle key={s.key} cx={hover.px} cy={pt.cy} r={3} fill={s.color} /> : null;
              })}
            </>
          )}
        </svg>
      </div>
      {hover && (
        <div
          className="absolute z-10 border border-border-subtle bg-bg px-2.5 py-1.5 pointer-events-none shadow-sm"
          style={{
            left: `calc(3.5rem + ${(hover.px / W) * 100}% * ${(1 - 56 / (wrapRef.current?.clientWidth ?? 600))})`,
            top: 18,
            transform: hover.px > W / 2 ? "translateX(-110%)" : "translateX(8px)",
          }}
        >
          <p className="kicker text-[8px] text-text-faint mb-0.5">{xs[hover.idx]}</p>
          {paths.map((s) => {
            const pt = s.yAt(hover.idx);
            return (
              <p key={s.key} className="num text-[11px] leading-snug" style={{ color: s.color }}>
                {s.label}: {pt ? pt.v.toFixed(1) : "—"}{unit}
              </p>
            );
          })}
        </div>
      )}
      <div className="flex justify-between kicker text-[8px] text-text-faint mt-1 pl-14">
        <span>{xs[0]}</span>
        <span>{xs[xs.length - 1]}</span>
      </div>
    </div>
  );
}
