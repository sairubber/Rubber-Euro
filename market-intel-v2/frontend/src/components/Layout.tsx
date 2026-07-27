import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn, relativeTime } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Ticker } from "@/components/Ticker";
import Prices from "@/pages/Prices";

const NAV_GROUPS = [
  {
    label: "News Wall",
    items: [
      { to: "/prices", label: "Prices", end: false, active: "border-tsr20 text-tsr20" },
      { to: "/", label: "Overview", end: true, active: "border-accent text-accent" },
      { to: "/wall/tsr20", label: "TSR20 Rubber", end: false, active: "border-tsr20 text-tsr20" },
      { to: "/wall/eurusd", label: "EUR/USD", end: false, active: "border-eurusd text-eurusd" },
      { to: "/history", label: "Archive", end: false, active: "border-accent text-accent" },
    ],
  },
  {
    label: "Analysis",
    items: [
      { to: "/analysis/trade-flow", label: "Trade & Supply", end: false, active: "border-accent text-accent" },
      { to: "/analysis/climate", label: "Climate Watch", end: false, active: "border-tsr20 text-tsr20" },
      { to: "/ports", label: "Port Traffic", end: false, active: "border-accent text-accent" },
    ],
  },
];

const WORDMARK = "The Research Wire";

function todayEdition(): string {
  return new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Masthead wordmark: each letter rises out of a mask, staggered — the
 * press-time moment. Runs once per full page load. */
function AnimatedWordmark() {
  return (
    <h1 className="headline text-3xl md:text-5xl font-bold tracking-tight text-text" aria-label={WORDMARK}>
      {WORDMARK.split("").map((ch, i) => (
        <span key={i} className="mask-line" aria-hidden="true">
          <span className="mask-rise" style={{ ["--stagger" as string]: `${i * 28}ms` }}>
            {ch === " " ? " " : ch}
          </span>
        </span>
      ))}
    </h1>
  );
}

export default function Layout() {
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: api.getStatus,
    refetchInterval: 60_000,
  });
  // The Prices page stays mounted permanently and is only hidden on other
  // routes — unmounting would destroy the TradingView iframe and with it
  // everything the user drew or configured on the chart.
  const isPrices = useLocation().pathname === "/prices";

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <div className="grain" aria-hidden="true" />

      <header className="border-b border-rule">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 pt-6 pb-5">
          <div className="flex items-center justify-between kicker text-[10px] text-text-faint mb-5">
            <span>{todayEdition()} · IST Edition</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span
                    className={cn(
                      "pulse-ring absolute inline-flex h-1.5 w-1.5",
                      status?.scheduler_running ? "text-tsr20" : "text-text-faint"
                    )}
                  />
                  <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", status?.scheduler_running ? "bg-tsr20" : "bg-text-faint")} />
                </span>
                {status?.scheduler_running ? "Desk live · 24/7" : "Desk idle"}
              </span>
              {status?.last_scrape_at && (
                <span className="hidden sm:inline" title={status.last_scrape_at}>
                  Last scraped {relativeTime(status.last_scrape_at)}
                </span>
              )}
            </div>
          </div>

          <NavLink to="/" className="block text-center group">
            <AnimatedWordmark />

            {/* Hero rule draws itself out from the centre once the wordmark
                letters have landed — the press-time beat that ties the
                masthead together. */}
            <span
              className="draw-rule block h-px bg-rule mx-auto mt-4 w-full max-w-lg"
              style={{ ["--stagger" as string]: "520ms" }}
              aria-hidden="true"
            />

            <p className="kicker text-[10px] md:text-[11px] mt-3 rise-in" style={{ animationDelay: "760ms" }}>
              <span className="text-tsr20">TSR20 Natural Rubber</span>
              <span className="text-text-faint"> · </span>
              <span className="text-eurusd">EUR/USD</span>
            </p>
          </NavLink>
        </div>

        <nav className="border-t border-rule">
          {/* mx-auto on the INNER wrapper, not justify-center on the scroll
              container: centered overflow clips its leading items (the
              Prices tab was unreachable on phones). Auto margins center the
              row when it fits and let it scroll from the start when not. */}
          <div className="max-w-[1600px] mx-auto px-2 md:px-8 flex items-center overflow-x-auto">
            <div className="flex items-center gap-1 mx-auto">
            {NAV_GROUPS.map((group, gi) => (
              <div key={group.label} className="flex items-center">
                {gi > 0 && (
                  <span className="kicker text-[9px] text-text-faint px-3 select-none" aria-hidden="true">
                    /
                  </span>
                )}
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "shrink-0 px-3.5 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                        isActive ? item.active : "border-transparent text-text-dim hover:text-text"
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
            </div>
          </div>
        </nav>

        <Ticker />
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 md:px-8 py-8 md:py-12">
        <div className={cn(isPrices && "hidden")}>
          <Outlet />
        </div>
        <div className={cn(!isPrices && "hidden")}>
          <Prices />
        </div>
      </main>

      <footer className="border-t border-rule mt-auto">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-8 kicker text-[10px] text-text-faint text-center">
          The Research Wire — real news aggregated from public sources. Not investment advice. Research &amp; display only.
        </div>
      </footer>
    </div>
  );
}
