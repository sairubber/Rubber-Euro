import { useEffect, useRef, useState } from "react";

/** Ambient hero video behind the lead story.
 *
 * Deliberately cheap to load: `preload="none"` semantics via a mount gate —
 * the ~17MB file is not fetched until the hero is actually on screen, so it
 * never blocks first paint or burns mobile data on a bounce. Muted +
 * playsInline (iOS refuses to autoplay otherwise) and aria-hidden — it is
 * decoration, and every fact on the page is in the text.
 *
 * Under prefers-reduced-motion the video is never fetched or played; the
 * ink wash stands in.
 */
export function HeroVideo({ className = "" }: { className?: string }) {
  // Two refs on purpose: the container is what we observe (it exists from
  // first render), the video is what we play (it only exists after the gate
  // opens). Observing the video directly can't work — it isn't in the DOM
  // yet at the moment we need to decide whether to load it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

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
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Play only AFTER React has committed the <video>. Calling play() inside
  // the observer callback ran a frame too early — setState is async, the
  // element had no source yet, and the promise rejected silently, leaving
  // the video stuck at readyState 0.
  useEffect(() => {
    if (!shouldLoad) return;
    videoRef.current?.play().catch(() => {
      /* autoplay refused by the browser — the wash is a fine fallback */
    });
  }, [shouldLoad]);

  return (
    // No `relative` here: the caller positions this (usually `absolute
    // inset-0`), and setting both meant two competing `position` rules whose
    // winner depended on Tailwind's stylesheet order rather than intent.
    <div ref={containerRef} className={`overflow-hidden bg-surface ${className}`} aria-hidden="true">
      {shouldLoad && (
        <video
          ref={videoRef}
          src="/hero.mp4"
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* Ink wash: keeps headline contrast honest over an unpredictable
          frame, and doubles as the reduced-motion still. */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#14100c]/85 via-[#14100c]/45 to-[#14100c]/15" />
    </div>
  );
}
