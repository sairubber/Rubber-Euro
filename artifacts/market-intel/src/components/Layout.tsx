import React from "react";
import { Link, useLocation } from "wouter";
import { useGetSystemStatus } from "@workspace/api-client-react";
import { useIsDark } from "@/hooks/use-dark";
import { Activity, BarChart3, Clock, LayoutDashboard, Settings, ShieldAlert, Ship, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/flash", label: "Flash Desk", icon: Zap },
  { href: "/weekly", label: "Weekly Review", icon: Clock },
  { href: "/scorecard", label: "Model Scorecard", icon: BarChart3 },
  { href: "/ports", label: "Port Traffic", icon: Ship },
  { href: "/history", label: "Archive", icon: Activity },
];

export function Layout({ children }: { children: React.ReactNode }) {
  useIsDark();
  const [location] = useLocation();
  const { data: status } = useGetSystemStatus();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {status && !status.api_key_configured && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-center gap-2 text-amber-500 font-mono text-sm">
          <ShieldAlert className="w-4 h-4" />
          <span>ANTHROPIC_API_KEY not set — analyses cannot run. Add it to Replit Secrets.</span>
        </div>
      )}
      
      <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0 sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-mono font-bold text-lg tracking-tighter flex items-center gap-2">
            <div className="w-4 h-4 bg-primary rounded-sm animate-pulse" />
            MARKET<span className="text-muted-foreground">INTEL</span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    isActive 
                      ? "bg-accent text-foreground" 
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", status?.scheduler_running ? "bg-primary" : "bg-muted")} />
              <span className={cn("relative inline-flex rounded-full h-2 w-2", status?.scheduler_running ? "bg-primary" : "bg-muted")} />
            </span>
            SYSTEM {status?.scheduler_running ? "ONLINE" : "IDLE"}
          </div>
          {status?.model && (
            <div className="text-xs font-mono bg-accent px-2 py-1 rounded-md text-muted-foreground border border-border">
              {status.model}
            </div>
          )}
        </div>
      </header>
      
      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  );
}
