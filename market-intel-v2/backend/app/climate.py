import logging
import statistics
from datetime import date

import httpx

logger = logging.getLogger("market_intel")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Every major natural-rubber producing belt — real coordinates, used for
# genuine Open-Meteo rainfall data (no API key required). Together these
# cover ~95% of world NR output.
PRODUCING_REGIONS: dict[str, dict] = {
    "South Thailand": {"country": "Thailand", "lat": 7.89, "lon": 98.40},
    "NE Thailand": {"country": "Thailand", "lat": 16.44, "lon": 102.83},
    "Sumatra Indonesia": {"country": "Indonesia", "lat": -0.59, "lon": 101.34},
    "Kalimantan Indonesia": {"country": "Indonesia", "lat": -1.68, "lon": 113.38},
    "Binh Phuoc Vietnam": {"country": "Vietnam", "lat": 11.75, "lon": 106.98},
    "Peninsular Malaysia": {"country": "Malaysia", "lat": 3.75, "lon": 102.25},
    "Kottayam India": {"country": "India", "lat": 9.59, "lon": 76.52},
    "Tripura India": {"country": "India", "lat": 23.94, "lon": 91.99},
    "Abidjan Ivory Coast": {"country": "Ivory Coast", "lat": 5.36, "lon": -4.01},
    "Hainan China": {"country": "China", "lat": 19.20, "lon": 109.75},
    "Kampong Cham Cambodia": {"country": "Cambodia", "lat": 11.99, "lon": 105.46},
    "Mon State Myanmar": {"country": "Myanmar", "lat": 16.25, "lon": 97.72},
    "Mindanao Philippines": {"country": "Philippines", "lat": 7.19, "lon": 124.23},
    "Kalutara Sri Lanka": {"country": "Sri Lanka", "lat": 6.58, "lon": 80.05},
    "Harbel Liberia": {"country": "Liberia", "lat": 6.28, "lon": -10.35},
    "Edo Nigeria": {"country": "Nigeria", "lat": 6.34, "lon": 5.62},
}


def fetch_region_rainfall(lat: float, lon: float) -> dict:
    """Real daily precipitation from Open-Meteo — free, no API key. 30 days
    of history plus a 7-day forecast, so the map can show what's coming at a
    plantation, not just what already fell."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "precipitation_sum",
        "past_days": 30,
        "forecast_days": 7,
        "timezone": "auto",
    }
    resp = httpx.get(OPEN_METEO_URL, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def compute_disruption_score(daily_mm: list[float]) -> tuple[float, float, float]:
    """Derive a 0-100 anomaly score from real rainfall data: how far the trailing
    7-day average sits from the trailing 30-day baseline. This is our own heuristic,
    not an official index — surfaced as such in the UI."""
    if not daily_mm:
        return 0.0, 0.0, 0.0

    last_7 = daily_mm[-7:] if len(daily_mm) >= 7 else daily_mm
    baseline = daily_mm[:-1] if len(daily_mm) > 1 else daily_mm  # exclude today (partial day)

    avg_7d = statistics.fmean(last_7) if last_7 else 0.0
    avg_30d = statistics.fmean(baseline) if baseline else 0.0

    if avg_30d < 0.5:
        # Baseline is essentially dry — any sustained rain is a bigger relative anomaly.
        deviation_pct = min(100.0, avg_7d * 20)
    else:
        deviation_pct = min(100.0, abs(avg_7d - avg_30d) / avg_30d * 100)

    return round(avg_7d, 1), round(avg_30d, 1), round(deviation_pct, 1)


def fetch_all_regions() -> list[dict]:
    """Fetch real rainfall + derived disruption score for every producing region."""
    results = []
    today = date.today().isoformat()

    for region, cfg in PRODUCING_REGIONS.items():
        try:
            data = fetch_region_rainfall(cfg["lat"], cfg["lon"])
            daily = data.get("daily", {})
            raw = daily.get("precipitation_sum", []) or []
            series = [0.0 if v is None else float(v) for v in raw]
            # past_days=30 + forecast_days=7 → the first 30 entries are
            # history, the rest (today onwards) are forecast. The anomaly
            # score must only ever see history — mixing forecast into the
            # baseline would let a predicted storm distort today's score.
            past = series[:30]
            future = series[30:]
            today_mm = future[0] if future else (past[-1] if past else 0.0)
            avg_7d, avg_30d, disruption = compute_disruption_score(past)
            forecast_7d = round(sum(future), 1)

            results.append(
                {
                    "region": region,
                    "country": cfg["country"],
                    "reading_date": today,
                    "rainfall_today_mm": round(today_mm, 1),
                    "rainfall_7d_avg_mm": avg_7d,
                    "rainfall_30d_avg_mm": avg_30d,
                    "forecast_7d_mm": forecast_7d,
                    "disruption_score": disruption,
                }
            )
        except Exception:
            logger.exception("Failed to fetch Open-Meteo data for %s", region)

    return results
