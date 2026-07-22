"""
Rule-based supply-signal engine: combines real climate data (Open-Meteo
rainfall anomaly) with real scraped news (disruption-category articles
matched by country) into a transparent, auditable composite score.

This is NOT an AI model and makes NO market-price predictions. Every number
here is either a direct measurement (rainfall) or a simple, disclosed
arithmetic combination of measurements and article counts. The output is a
supply-side *risk outlook*, not investment advice.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.climate import PRODUCING_REGIONS
from app.models import ClimateReading, NewsArticle

NEWS_LOOKBACK_DAYS = 14
NEWS_BOOST_PER_ARTICLE = 15
NEWS_BOOST_CAP = 45


def _risk_level(score: float) -> str:
    if score < 25:
        return "Low"
    if score < 55:
        return "Moderate"
    if score < 75:
        return "Elevated"
    return "High"


def _trend(current: float, previous: float | None) -> str:
    if previous is None:
        return "No prior reading"
    delta = current - previous
    if abs(delta) < 3:
        return "Steady"
    return "Worsening" if delta > 0 else "Improving"


def compute_region_signals(db: Session) -> list[dict]:
    """One composite signal per producing region, built entirely from
    real inputs already in the DB — no external calls made here."""
    since = datetime.now(timezone.utc) - timedelta(days=NEWS_LOOKBACK_DAYS)

    # Latest two readings per region, so we can show a trend.
    all_readings = (
        db.query(ClimateReading)
        .filter(ClimateReading.region.in_(PRODUCING_REGIONS.keys()))
        .order_by(ClimateReading.region, ClimateReading.created_at.desc())
        .all()
    )
    by_region: dict[str, list[ClimateReading]] = {}
    for r in all_readings:
        by_region.setdefault(r.region, []).append(r)

    # Disruption-article counts per country, last N days. TSR20-only — this
    # engine is a rubber supply signal, EUR/USD disruption news must never
    # factor into it (a bug we hit: this query used to have no market filter
    # at all, so EUR/USD articles could leak into a rubber region's score).
    disruption_counts = dict(
        db.query(NewsArticle.country, func.count(NewsArticle.id))
        .filter(
            NewsArticle.market_tag == "TSR20",
            NewsArticle.category == "disruption",
            NewsArticle.country.isnot(None),
            NewsArticle.published_at >= since,
        )
        .group_by(NewsArticle.country)
        .all()
    )

    signals = []
    for region, cfg in PRODUCING_REGIONS.items():
        readings = by_region.get(region, [])
        if not readings:
            continue
        current = readings[0]
        previous = readings[1] if len(readings) > 1 else None

        country = cfg["country"]
        article_count = disruption_counts.get(country, 0)
        news_boost = min(article_count * NEWS_BOOST_PER_ARTICLE, NEWS_BOOST_CAP)
        composite = min(100.0, current.disruption_score + news_boost)
        trend = _trend(current.disruption_score, previous.disruption_score if previous else None)
        level = _risk_level(composite)

        trend_note = "no prior reading yet to compare" if trend == "No prior reading" else f"{trend.lower()} vs prior reading"
        rationale_parts = [f"Rainfall anomaly score {current.disruption_score:.0f}/100 ({trend_note})"]
        if article_count > 0:
            rationale_parts.append(f"{article_count} disruption report{'s' if article_count != 1 else ''} matched to {country} in the last {NEWS_LOOKBACK_DAYS} days")
        else:
            rationale_parts.append(f"no disruption reports matched to {country} in the last {NEWS_LOOKBACK_DAYS} days")

        signals.append(
            {
                "region": region,
                "country": country,
                "risk_level": level,
                "composite_score": round(composite, 1),
                "climate_score": current.disruption_score,
                "news_article_count": article_count,
                "trend": trend,
                "rationale": "; ".join(rationale_parts) + ".",
            }
        )

    return signals


def compute_market_outlook(region_signals: list[dict]) -> dict:
    """One aggregate line for the whole TSR20 supply picture — still just
    arithmetic over the region signals above, nothing inferred beyond that."""
    if not region_signals:
        return {
            "headline": "No signal yet",
            "summary": "Climate and news data are still being gathered — check back shortly.",
            "elevated_region_count": 0,
            "worsening_region_count": 0,
            "total_regions": 0,
        }

    elevated = [s for s in region_signals if s["risk_level"] in ("Elevated", "High")]
    worsening = [s for s in region_signals if s["trend"] == "Worsening"]

    if not elevated:
        headline = "No elevated supply risk detected"
        summary = f"All {len(region_signals)} tracked producing regions show normal rainfall patterns with no corroborating disruption news."
    else:
        names = ", ".join(s["region"] for s in elevated[:3])
        headline = f"Supply risk elevated in {len(elevated)} of {len(region_signals)} regions"
        summary = f"{names} showing rainfall anomalies{' with corroborating disruption news' if any(s['news_article_count'] > 0 for s in elevated) else ''}."

    return {
        "headline": headline,
        "summary": summary,
        "elevated_region_count": len(elevated),
        "worsening_region_count": len(worsening),
        "total_regions": len(region_signals),
    }
