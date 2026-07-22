import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CountryBreakdownItem } from "@/lib/types";

// Fixed categorical order — assigned by position, never re-cycled per render.
// Categorical, so hues must stay maximally separable rather than ramp — and
// each must clear contrast against cream, which the old pastel set did not.
const PALETTE = ["#2f6b4f", "#2b4c7e", "#9d6f1d", "#8c4f73", "#1e7a45", "#5b4b93", "#b3352f"];
const UNSPECIFIED_COLOR = "#a89e8d";

function colorFor(country: string, index: number): string {
  if (country === "Unspecified") return UNSPECIFIED_COLOR;
  return PALETTE[index % PALETTE.length];
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { fill: string } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="bg-bg-raised border border-border px-3 py-2 text-xs">
      <p style={{ color: p.payload.fill }}>
        {p.name}: <span className="num font-medium">{p.value} article{p.value !== 1 ? "s" : ""}</span>
      </p>
    </div>
  );
}

export function CountryPieChart({ data }: { data: CountryBreakdownItem[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return null;

  const chartData = data.map((d, i) => ({ name: d.country, value: d.count, fill: colorFor(d.country, i) }));

  return (
    <div>
      <p className="kicker text-[11px] text-text-faint mb-1">Real Coverage by Country</p>
      <p className="text-[11px] text-text-faint mb-4">
        {total} real trade/export article{total !== 1 ? "s" : ""}, grouped by the country each one mentions — "Unspecified" means no
        tracked country was named in the headline or summary.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={1.5}
            isAnimationActive={false}
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} stroke="#f7f4ed" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip />} />
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: "#574f44" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
