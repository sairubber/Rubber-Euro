export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function formatIST(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " IST";
  } catch {
    return iso;
  }
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Split a feed into `n` column stacks that each read chronologically top to
 * bottom. A plain multi-column grid fills row-major, which zigzags the time
 * order across columns — fine for a mosaic, wrong for a wire. */
export function splitColumns<T>(items: T[], n: number): T[][] {
  const per = Math.ceil(items.length / n);
  return Array.from({ length: n }, (_, i) => items.slice(i * per, (i + 1) * per)).filter((c) => c.length > 0);
}

/** Web image-search thumbnail for a headline — the stand-in when an article
 * carries no og:image of its own. */
export function newsImageFallback(title: string, w = 400, h = 300): string {
  return `https://tse2.mm.bing.net/th?q=${encodeURIComponent(title)}&w=${w}&h=${h}&c=7&rs=1&p=0`;
}

export function directionColor(direction: string): string {
  const d = direction.toLowerCase();
  if (d.includes("increas")) return "text-bull";
  if (d.includes("decreas")) return "text-bear";
  if (d.includes("stable")) return "text-neutral";
  return "text-text-faint";
}

export function convictionTier(score: number): "low" | "mid" | "high" {
  if (score <= 3) return "low";
  if (score <= 6) return "mid";
  return "high";
}
