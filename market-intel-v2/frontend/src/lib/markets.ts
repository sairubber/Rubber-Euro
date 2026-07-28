// EUR/USD is hidden site-wide for now (the desk is rubber-focused) — flip
// this to bring the tab, wall, chart and ticker items straight back. The
// backend keeps collecting EUR/USD data throughout, so nothing is lost.
export const SHOW_EURUSD = false;

const ALL_MARKETS = [
  { code: "TSR20", label: "TSR20 Rubber" },
  { code: "EURUSD", label: "EUR/USD" },
] as const;

export const MARKETS = ALL_MARKETS.filter((m) => SHOW_EURUSD || m.code !== "EURUSD");
