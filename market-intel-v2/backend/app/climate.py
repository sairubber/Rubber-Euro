import logging
import statistics
from datetime import date

import httpx

logger = logging.getLogger("market_intel")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Major natural-rubber producing regions — real coordinates, used for genuine
# Open-Meteo rainfall data (no API key required).
PRODUCING_REGIONS: dict[str, dict] = {
    "South Thailand": {"country": "Thailand", "lat": 7.89, "lon": 98.40},
    "NE Thailand": {"country": "Thailand", "lat": 16.44, "lon": 102.83},
    "Sumatra Indonesia": {"country": "Indonesia", "lat": -0.59, "lon": 101.34},
    "Binh Phuoc Vietnam": {"country": "Vietnam", "lat": 11.75, "lon": 106.98},
    "Peninsular Malaysia": {"country": "Malaysia", "lat": 3.75, "lon": 102.25},
    "Kottayam India": {"country": "India", "lat": 9.59, "lon": 76.52},
    "Abidjan Ivory Coast": {"country": "Ivory Coast", "lat": 5.36, "lon": -4.01},
}


def fetch_region_rainfall(lat: float, lon: float) -> dict:
    """Real daily precipitation from Open-Meteo — free, no API key. Returns raw daily series."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "precipitation_sum",
        "past_days": 30,
        "forecast_days": 1,
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
            precip = [v for v in daily.get("precipitation_sum", []) if v is not None]
            today_mm = precip[-1] if precip else 0.0
            avg_7d, avg_30d, disruption = compute_disruption_score(precip)

            results.append(
                {
                    "region": region,
                    "country": cfg["country"],
                    "reading_date": today,
                    "rainfall_today_mm": round(today_mm, 1),
                    "rainfall_7d_avg_mm": avg_7d,
                    "rainfall_30d_avg_mm": avg_30d,
                    "disruption_score": disruption,
                }
            )
        except Exception:
            logger.exception("Failed to fetch Open-Meteo data for %s", region)

    return results
