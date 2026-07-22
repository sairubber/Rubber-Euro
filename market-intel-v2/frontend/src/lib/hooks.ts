import { useCallback, useEffect, useRef, useState } from "react";

/** Re-renders the caller on an interval so relative timestamps ("3m ago")
 * stay honest while a tab sits open — the wall is a live page, not a
 * snapshot. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Scroll-entry reveal: adds `is-visible` to the element once it enters the
 * viewport. Pair with the `.reveal` utility. Returns a CALLBACK ref, not an
 * object ref — the revealed sections mount conditionally after data loads,
 * and a mount-time useEffect would run before they exist (a bug we hit:
 * every section stayed at opacity 0 forever). IntersectionObserver, never a
 * scroll listener — fires once, then disconnects. */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const observerRef = useRef<IntersectionObserver | null>(null);
  return useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-visible");
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    observerRef.current = observer;
  }, []);
}
