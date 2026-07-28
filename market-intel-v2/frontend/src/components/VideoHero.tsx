import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";

/** Full-width desk video at the top of the front page.
 *
 * Loading is gated on visibility even though it sits above the fold — on a
 * slow connection the poster-less <video> would otherwise contend with the
 * first paint of the headlines, which are the actual content. Muted +
 * playsInline because iOS refuses to autoplay otherwise; aria-hidden because
 * it carries no information the text doesn't.
 *
 * Never fetched or played under prefers-reduced-motion.
 */
export function VideoHero() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  const { data: status } = useQuery({ queryKey: ["status"], queryFn: api.getStatus, refetchInterval: 60_000 });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Play only after React has committed the <video> — calling play() in the
  // observer callback runs before the element exists and rejects silently.
  useEffect(() => {
    if (!shouldLoad) return;
    videoRef.current?.play().catch(() => {});
  }, [shouldLoad]);

  return (
    <section
      ref={containerRef}
      className="relative overflow-hidden border border-border bg-surface h-[220px] sm:h-[320px] lg:h-[420px]"
    >
      {shouldLoad && (
        <video
          ref={videoRef}
          src="/hero.mp4"
          muted
          loop
          playsInline
          // autoPlay as well as the explicit play() below: the attribute
          // covers the case where React commits the element while the tab is
          // backgrounded and our play() call is suspended by the browser.
          autoPlay
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0b0906]/90 via-[#0b0906]/40 to-[#0b0906]/15" />

      <div className="relative h-full flex flex-col justify-end p-5 sm:p-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="relative inline-flex h-2 w-2">
            <span
              className={cn("pulse-ring absolute inline-flex h-2 w-2", status?.scheduler_running ? "text-tsr20" : "text-white/50")}
            />
            <span
              className={cn("relative inline-flex h-2 w-2 rounded-full", status?.scheduler_running ? "bg-tsr20" : "bg-white/50")}
            />
          </span>
          <span className="kicker text-[9px] text-white/80">
            {status?.scheduler_running ? "Desk live · scraping 24/7" : "Desk idle"}
          </span>
          {status?.last_scrape_at && (
            <span className="kicker text-[9px] text-white/50">· last pull {relativeTime(status.last_scrape_at)}</span>
          )}
        </div>

        <h1 className="headline text-2xl sm:text-4xl lg:text-5xl font-bold text-white leading-[1.08] max-w-3xl">
          <span className="mask-line">
            <span className="mask-rise">Market Intelligence Desk</span>
          </span>
        </h1>
        <p className="text-sm sm:text-base text-white/75 mt-3 max-w-2xl leading-relaxed">
          TSR20 natural rubber — official customs data, scraped headlines, and rule-based supply signals.
        </p>
      </div>
    </section>
  );
}
