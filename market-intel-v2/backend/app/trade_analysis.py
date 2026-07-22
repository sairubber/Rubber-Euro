"""
Supply/demand analysis over the stored Comtrade archive — plain arithmetic,
zero AI, every number traceable to a customs filing.

Definitions used throughout, stated once so the UI can repeat them honestly:
  SUPPLY  = exports of HS 4001 by a producing country
  DEMAND  = imports of HS 4001 by a consuming country
  change  = (latest - prior) / prior, on the same metric and same frequency

"Demand rose in X" therefore means "X's customs-declared rubber imports were
higher in the latest complete period than the one before it". That is a
measurement, not a forecast, and the UI must not imply otherwise.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import TradeFlow
from app.trade_data import RUBBER_GRADES

SUPPLY = "X"
DEMAND = "M"


# A period only counts as usable once most reporters have actually filed.
# Comtrade publishes continuously, so the newest period always exists but is
# near-empty: at the time of writing 2025 held 6 exporters while 2023 held
# the full set — and Thailand, the single largest exporter, was missing.
# Ranking or totalling that period would have understated global supply by
# more than half and shown Indonesia as the world's top exporter, which is
# false. Periods below this share of the best-covered period are excluded.
# 0.85, not 0.7: at 0.7 the 2024 TSR year squeaked through with 12 of 17
# reporters and printed a "-40.8% year on year" that was almost entirely
# missing filings rather than a real collapse in exports. A percentage
# change is only honest when both periods have near-identical coverage.
COVERAGE_THRESHOLD = 0.85


COMTRADE = "un-comtrade"
EUROSTAT = "eurostat"


def _scope(query, hs_code: str | None, source: str = COMTRADE):
    """Every analysis query is either grade-specific or all-grades, and is
    always pinned to ONE source. Two guards in one place: a caller can't sum
    TSR and latex tonnage into a meaningless total, and can't sum Comtrade
    USD with Eurostat EUR into a meaningless value."""
    query = query.filter(TradeFlow.source == source)
    return query.filter(TradeFlow.hs_code == hs_code) if hs_code else query


def eu_imports(db: Session, limit_months: int = 12) -> dict:
    """EU customs declarations from Eurostat — the fresh view.

    Kept entirely separate from the Comtrade analysis rather than merged:
    the values are EUR not USD, and the reporter universe is the EU27 alone
    rather than every country on earth. Merging them would produce a total
    that means nothing. What this buys is currency: Eurostat runs about five
    months behind, where Comtrade's newest complete year is two years back."""
    periods = [
        p[0]
        for p in db.query(TradeFlow.period)
        .filter(TradeFlow.source == EUROSTAT, TradeFlow.flow == DEMAND)
        .distinct()
        .order_by(TradeFlow.period.desc())
        .limit(limit_months)
        .all()
    ]
    if not periods:
        return {"latest_period": None, "prior_period": None, "currency": "EUR", "rows": [], "months": []}

    periods = sorted(periods)
    latest, prior = periods[-1], (periods[-2] if len(periods) > 1 else None)

    def totals(period: str) -> dict[str, dict]:
        rows = (
            db.query(TradeFlow.partner_name, func.sum(TradeFlow.value_usd), func.sum(TradeFlow.qty_kg))
            .filter(
                TradeFlow.source == EUROSTAT,
                TradeFlow.flow == DEMAND,
                TradeFlow.period == period,
            )
            .group_by(TradeFlow.partner_name)
            .all()
        )
        return {n: {"value": float(v or 0), "qty_kg": float(q or 0)} for n, v, q in rows}

    now, before = totals(latest), (totals(prior) if prior else {})
    out_rows = []
    for country, cur in now.items():
        prev = before.get(country)
        out_rows.append(
            {
                "country": country,
                "value_eur": cur["value"],
                "qty_kg": cur["qty_kg"],
                "change_pct": _pct_change(cur["value"], prev["value"]) if prev else None,
            }
        )
    out_rows.sort(key=lambda r: -r["value_eur"])

    monthly = []
    for period in periods:
        t = totals(period)
        monthly.append(
            {
                "period": period,
                "value_eur": sum(v["value"] for v in t.values()),
                "qty_kg": sum(v["qty_kg"] for v in t.values()),
            }
        )

    return {
        "latest_period": latest,
        "prior_period": prior,
        "currency": "EUR",
        "rows": out_rows,
        "months": monthly,
    }


def _periods(db: Session, freq: str, flow: str, hs_code: str | None = None, limit: int = 40) -> list[str]:
    """Periods with enough reporter coverage to compare honestly, oldest
    first. Incomplete newest periods are dropped, not shown."""
    q = db.query(TradeFlow.period, func.count(func.distinct(TradeFlow.reporter_code))).filter(
        TradeFlow.freq == freq, TradeFlow.flow == flow, TradeFlow.partner_code == 0
    )
    rows = _scope(q, hs_code).group_by(TradeFlow.period).order_by(TradeFlow.period.desc()).limit(limit).all()
    if not rows:
        return []
    # Median, not max. Against the max, a couple of unusually well-reported
    # early months set an unreachable bar and threw away every later month:
    # TSR monthly held 18 periods (Nov 2024 → Apr 2026) but two of them had
    # 10 reporters while the rest sat steadily at 6, so a max-based cutoff
    # kept 2 and hid 16. Comparing those steady 6-reporter months to each
    # other is perfectly valid — what isn't valid is comparing a 6-reporter
    # month to a 10-reporter one, and the median keeps that guard while
    # letting a consistently-reported run through.
    counts = sorted(count for _, count in rows)
    reference = counts[len(counts) // 2]
    cutoff = reference * COVERAGE_THRESHOLD
    return sorted(period for period, count in rows if count >= cutoff)


def freshness(db: Session) -> list[dict]:
    """What is actually available, per grade — the complete period (enough
    reporters to rank) and the newest partial filing (anything at all).

    Customs data is filed with a long lag: at the time of writing the newest
    complete year was 2024 while the calendar read 2026, and 2026 months had
    one or two reporters. Showing only the complete figure looks stale;
    showing only the newest looks wrong. The page shows both and says which
    is which."""
    out = []
    for hs_code, grade in RUBBER_GRADES.items():
        complete = _periods(db, "A", SUPPLY, hs_code)
        newest_annual = (
            _scope(
                db.query(func.max(TradeFlow.period)).filter(
                    TradeFlow.freq == "A", TradeFlow.flow == SUPPLY, TradeFlow.partner_code == 0
                ),
                hs_code,
            ).scalar()
        )
        newest_monthly = (
            _scope(
                db.query(func.max(TradeFlow.period)).filter(
                    TradeFlow.freq == "M", TradeFlow.flow == SUPPLY, TradeFlow.partner_code == 0
                ),
                hs_code,
            ).scalar()
        )
        latest_complete = complete[-1] if complete else None
        partial_count = 0
        if newest_annual and newest_annual != latest_complete:
            partial_count = (
                _scope(
                    db.query(func.count(func.distinct(TradeFlow.reporter_code))).filter(
                        TradeFlow.freq == "A",
                        TradeFlow.flow == SUPPLY,
                        TradeFlow.partner_code == 0,
                        TradeFlow.period == newest_annual,
                    ),
                    hs_code,
                ).scalar()
                or 0
            )
        out.append(
            {
                "hs_code": hs_code,
                "grade": grade,
                "latest_complete_year": latest_complete,
                "latest_filed_year": newest_annual,
                "latest_filed_year_reporters": partial_count,
                "latest_filed_month": newest_monthly,
            }
        )
    return out


def _totals_for_period(
    db: Session, freq: str, flow: str, period: str, hs_code: str | None = None
) -> dict[str, dict]:
    q = db.query(
        TradeFlow.reporter_name,
        func.sum(TradeFlow.value_usd),
        func.sum(TradeFlow.qty_kg),
    ).filter(
        TradeFlow.freq == freq,
        TradeFlow.flow == flow,
        TradeFlow.partner_code == 0,
        TradeFlow.period == period,
    )
    rows = _scope(q, hs_code).group_by(TradeFlow.reporter_name).all()
    return {name: {"value_usd": float(v or 0), "qty_kg": float(q or 0)} for name, v, q in rows}


def grade_totals(db: Session, freq: str = "A") -> list[dict]:
    """Per-grade series — the separate Latex / RSS / TSR / Cup Lump charts.
    Each grade carries its own period list, because coverage differs by
    grade: a country can file TSR and not file latex in the same month."""
    out = []
    for hs_code, grade in RUBBER_GRADES.items():
        periods = _periods(db, freq, SUPPLY, hs_code)
        points = []
        for period in periods:
            totals = _totals_for_period(db, freq, SUPPLY, period, hs_code)
            points.append(
                {
                    "period": period,
                    "value_usd": sum(v["value_usd"] for v in totals.values()),
                    "qty_kg": sum(v["qty_kg"] for v in totals.values()),
                    "reporters": len(totals),
                }
            )
        if not points:
            continue
        latest, prior = points[-1], (points[-2] if len(points) > 1 else None)
        top = sorted(
            (
                {"country": name, "value_usd": v["value_usd"], "qty_kg": v["qty_kg"]}
                for name, v in _totals_for_period(db, freq, SUPPLY, latest["period"], hs_code).items()
            ),
            key=lambda r: -r["value_usd"],
        )[:8]
        out.append(
            {
                "hs_code": hs_code,
                "grade": grade,
                "freq": freq,
                "points": points,
                "latest_period": latest["period"],
                "latest_value_usd": latest["value_usd"],
                "latest_qty_kg": latest["qty_kg"],
                "change_pct": _pct_change(latest["value_usd"], prior["value_usd"]) if prior else None,
                "qty_change_pct": _pct_change(latest["qty_kg"], prior["qty_kg"]) if prior and prior["qty_kg"] else None,
                "top_producers": top,
            }
        )
    return out


def _pct_change(latest: float, prior: float) -> float | None:
    if not prior:
        return None
    return round((latest - prior) / prior * 100, 1)


def movers(db: Session, flow: str, freq: str = "A") -> dict:
    """Which countries' supply (or demand) rose and fell, latest complete
    period vs the one before. Returns both directions plus the periods being
    compared so the UI can label the comparison instead of asserting a bare
    percentage."""
    periods = _periods(db, freq, flow)
    if len(periods) < 2:
        return {"latest_period": periods[-1] if periods else None, "prior_period": None, "rows": []}

    latest_p, prior_p = periods[-1], periods[-2]
    latest = _totals_for_period(db, freq, flow, latest_p)
    prior = _totals_for_period(db, freq, flow, prior_p)

    rows = []
    for name, cur in latest.items():
        prev = prior.get(name)
        rows.append(
            {
                "country": name,
                "value_usd": cur["value_usd"],
                "qty_kg": cur["qty_kg"],
                "prior_value_usd": prev["value_usd"] if prev else None,
                "change_pct": _pct_change(cur["value_usd"], prev["value_usd"]) if prev else None,
                "qty_change_pct": _pct_change(cur["qty_kg"], prev["qty_kg"]) if prev and prev["qty_kg"] else None,
            }
        )
    rows.sort(key=lambda r: r["value_usd"], reverse=True)
    return {"latest_period": latest_p, "prior_period": prior_p, "rows": rows}


def timeline(db: Session, freq: str = "M", top_n: int = 10) -> dict:
    """Per-period supply and demand totals by country — the frames of the
    animated chart. Only the countries that are top-N in the most recent
    period are carried across every frame, so bars stay comparable as the
    animation runs instead of the axis rescaling on every step."""
    # Only animate periods where BOTH sides reported. Exporters and importers
    # file on different schedules — monthly import data ran ~13 months ahead
    # of monthly export data here — and taking the union produced frames with
    # a full demand column and an empty supply column, which reads as "supply
    # collapsed to zero" rather than "nobody has filed yet".
    supply_periods = set(_periods(db, freq, SUPPLY))
    demand_periods = set(_periods(db, freq, DEMAND))
    periods = sorted(supply_periods & demand_periods)
    if not periods:
        return {"freq": freq, "frames": [], "supply_countries": [], "demand_countries": []}

    frames: dict[str, dict] = {p: {"period": p, "supply": [], "demand": []} for p in periods}
    tracked: dict[str, list[str]] = {}

    for flow, key in ((SUPPLY, "supply"), (DEMAND, "demand")):
        # Rank the tracked set by each country's total across the whole
        # window, not by the newest period alone — a country that simply
        # hasn't filed the last month shouldn't drop out of the race.
        totals_by_period = {p: _totals_for_period(db, freq, flow, p) for p in periods}
        cumulative: dict[str, float] = {}
        for totals in totals_by_period.values():
            for name, vals in totals.items():
                cumulative[name] = cumulative.get(name, 0.0) + vals["value_usd"]
        top = {name for name, _ in sorted(cumulative.items(), key=lambda kv: -kv[1])[:top_n]}
        tracked[key] = sorted(top)

        for period in periods:
            frames[period][key] = sorted(
                (
                    {"country": name, "value_usd": vals["value_usd"], "qty_kg": vals["qty_kg"]}
                    for name, vals in totals_by_period[period].items()
                    if name in top
                ),
                key=lambda r: -r["value_usd"],
            )

    return {
        "freq": freq,
        "frames": [frames[p] for p in periods],
        "supply_countries": tracked.get("supply", []),
        "demand_countries": tracked.get("demand", []),
    }


def bilateral_flows(db: Session, limit: int = 25) -> list[dict]:
    """Top exporter → importer lanes from the most recent bilateral pull."""
    # Best-covered bilateral year, not simply the newest — the newest year is
    # always thinly filed and would show a lane table missing the largest
    # exporters entirely.
    coverage = (
        db.query(TradeFlow.period, func.count(func.distinct(TradeFlow.reporter_code)))
        .filter(
            TradeFlow.source == COMTRADE,
            TradeFlow.freq == "A",
            TradeFlow.flow == SUPPLY,
            TradeFlow.partner_code != 0,
        )
        .group_by(TradeFlow.period)
        .all()
    )
    if not coverage:
        return []
    latest = max(coverage, key=lambda row: (row[1], row[0]))[0]

    rows = (
        db.query(
            TradeFlow.reporter_name,
            TradeFlow.partner_name,
            TradeFlow.value_usd,
            TradeFlow.qty_kg,
        )
        .filter(
            TradeFlow.source == COMTRADE,
            TradeFlow.freq == "A",
            TradeFlow.flow == SUPPLY,
            TradeFlow.partner_code != 0,
            TradeFlow.period == latest,
        )
        .order_by(TradeFlow.value_usd.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "period": latest,
            "exporter": exporter,
            "importer": importer,
            "value_usd": float(value),
            "qty_kg": float(qty or 0),
        }
        for exporter, importer, value, qty in rows
    ]


def balance_summary(db: Session) -> dict:
    """Headline read of the market: total measured supply vs demand for the
    latest complete year, and how each moved. Deliberately reports the two
    sides separately rather than subtracting them — Comtrade's exporter and
    importer universes are different sets of countries, so a global
    'surplus' computed from them would be an artifact, not a fact."""
    supply = movers(db, SUPPLY, "A")
    demand = movers(db, DEMAND, "A")

    def _total(m: dict) -> float:
        return sum(r["value_usd"] for r in m["rows"])

    def _prior_total(m: dict) -> float:
        return sum(r["prior_value_usd"] or 0 for r in m["rows"])

    supply_total, demand_total = _total(supply), _total(demand)
    supply_prior, demand_prior = _prior_total(supply), _prior_total(demand)

    rising_demand = [r["country"] for r in demand["rows"] if (r["change_pct"] or 0) > 0][:5]
    rising_supply = [r["country"] for r in supply["rows"] if (r["change_pct"] or 0) > 0][:5]

    # Each side carries its OWN periods. Exporters and importers file on
    # different schedules, so the best-covered supply year and the
    # best-covered demand year are often different — labelling both cards
    # with one period stamped 2024 on a demand figure that was actually 2025.
    return {
        "supply_period": supply["latest_period"],
        "supply_prior_period": supply["prior_period"],
        "demand_period": demand["latest_period"],
        "demand_prior_period": demand["prior_period"],
        "supply_total_usd": supply_total,
        "demand_total_usd": demand_total,
        "supply_change_pct": _pct_change(supply_total, supply_prior),
        "demand_change_pct": _pct_change(demand_total, demand_prior),
        "supply_country_count": len(supply["rows"]),
        "demand_country_count": len(demand["rows"]),
        "rising_demand": rising_demand,
        "rising_supply": rising_supply,
    }
