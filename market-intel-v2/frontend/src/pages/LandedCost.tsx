import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Landed Cost — a plain calculator, entirely client-side. Every number is
 * the user's own input; the only fetched value is the live USD/INR rate
 * (prefilled, still editable). Nothing here is advice — it's the same
 * arithmetic every physical desk runs on paper. */

interface Inputs {
  fob: number; // USD/tonne
  freight: number; // USD/tonne
  insurancePct: number; // % of (FOB + freight)
  dutyPct: number; // % of CIF
  clearing: number; // USD/tonne — port, CHA, handling
  trucking: number; // USD/tonne — inland leg
}

const DEFAULTS: Inputs = {
  fob: 2170,
  freight: 60,
  insurancePct: 0.3,
  dutyPct: 25,
  clearing: 25,
  trucking: 30,
};

function Field({
  label,
  suffix,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="kicker text-[9px] text-text-faint block mb-1">{label}</span>
      <span className="flex items-baseline gap-2 border border-border-subtle bg-surface px-3 py-2">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="num w-full bg-transparent text-text text-sm outline-none"
        />
        <span className="kicker text-[9px] text-text-faint shrink-0">{suffix}</span>
      </span>
    </label>
  );
}

export default function LandedCost() {
  const { data: board } = useQuery({ queryKey: ["price-board"], queryFn: api.getPriceBoard, staleTime: 60_000 });
  const [inputs, setInputs] = useState<Inputs>(DEFAULTS);

  const sgxFront = board?.quotes[0]?.price;

  const set = (k: keyof Inputs) => (v: number) => {
    setInputs((s) => ({ ...s, [k]: v }));
  };

  const out = useMemo(() => {
    const cfr = inputs.fob + inputs.freight;
    const insurance = (cfr * inputs.insurancePct) / 100;
    const cif = cfr + insurance;
    const duty = (cif * inputs.dutyPct) / 100;
    const landed = cif + duty + inputs.clearing + inputs.trucking;
    return { cfr, insurance, cif, duty, landed };
  }, [inputs]);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <header className="text-center border-b border-rule pb-6">
        <p className="kicker text-[10px] text-accent mb-2">Desk · Tools</p>
        <h1 className="headline text-4xl font-bold text-text">Landed Cost Calculator</h1>
        <p className="text-sm text-text-dim mt-2">
          FOB to factory gate, step by step. Every figure is yours to edit — duty rates and charges change, so confirm
          them with your CHA/broker before quoting anyone.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="kicker text-[10px] text-text-faint">Inputs</p>
            {sgxFront && (
              <button
                onClick={() => setInputs((s) => ({ ...s, fob: sgxFront }))}
                className="kicker text-[9px] text-accent hover:underline"
              >
                Use SGX front month (${sgxFront.toFixed(0)})
              </button>
            )}
          </div>
          <Field label="FOB price" suffix="USD/tonne" value={inputs.fob} onChange={set("fob")} />
          <Field label="Ocean freight" suffix="USD/tonne" value={inputs.freight} onChange={set("freight")} />
          <Field label="Insurance" suffix="% of C&F" value={inputs.insurancePct} onChange={set("insurancePct")} step={0.05} />
          <Field label="Import duty" suffix="% of CIF" value={inputs.dutyPct} onChange={set("dutyPct")} step={0.5} />
          <Field label="Port + clearing charges" suffix="USD/tonne" value={inputs.clearing} onChange={set("clearing")} />
          <Field label="Inland trucking" suffix="USD/tonne" value={inputs.trucking} onChange={set("trucking")} />
        </div>

        <div>
          <p className="kicker text-[10px] text-text-faint mb-4">Build-up — USD/tonne</p>
          <div className="border border-border-subtle bg-surface">
            {[
              ["FOB", inputs.fob],
              ["+ Ocean freight", inputs.freight],
              ["= C&F", out.cfr],
              [`+ Insurance (${inputs.insurancePct}%)`, out.insurance],
              ["= CIF", out.cif],
              [`+ Duty (${inputs.dutyPct}% of CIF)`, out.duty],
              ["+ Port & clearing", inputs.clearing],
              ["+ Inland trucking", inputs.trucking],
            ].map(([label, v]) => (
              <div key={label as string} className="flex items-baseline justify-between px-4 py-2 border-b border-border-subtle/60 text-sm">
                <span className={(label as string).startsWith("=") ? "text-text font-medium" : "text-text-dim"}>{label}</span>
                <span className="num text-text">${(v as number).toFixed(1)}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between px-4 py-3 bg-bg">
              <span className="headline font-bold text-text">Landed cost</span>
              <span className="text-right">
                <span className="num text-2xl font-bold text-text block">${out.landed.toFixed(0)}<span className="text-xs font-normal text-text-faint">/tonne</span></span>
                <span className="num text-[11px] text-text-dim block">${(out.landed / 1000).toFixed(3)}/kg</span>
              </span>
            </div>
          </div>
          <p className="kicker text-[9px] text-text-faint mt-3 leading-relaxed">
            Insurance is applied on C&amp;F, duty on CIF — the standard customs build-up. If your duty is specific
            (per-kg) rather than ad-valorem, set duty to 0 and fold it into clearing charges. All figures in USD.
          </p>
        </div>
      </div>
    </div>
  );
}
