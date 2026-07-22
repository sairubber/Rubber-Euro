import { BadgeCheck, ShieldCheck } from "lucide-react";
import type { Credibility } from "@/lib/types";

/** Source-credibility marker from the backend's rule-based tier list
 * (credibility.py). Unrated sources show nothing — absence of a badge is
 * the signal, and a third label would just be noise on every row. */
export function CredibilityBadge({ credibility }: { credibility: Credibility }) {
  if (credibility === "verified") {
    return (
      <span
        className="kicker text-[9px] text-accent flex items-center gap-1"
        title="Verified source — global wire, major financial press, or official body"
      >
        <BadgeCheck size={11} /> verified
      </span>
    );
  }
  if (credibility === "trusted") {
    return (
      <span
        className="kicker text-[9px] text-text-dim flex items-center gap-1"
        title="Trusted source — established regional or trade press"
      >
        <ShieldCheck size={11} /> trusted
      </span>
    );
  }
  return null;
}
