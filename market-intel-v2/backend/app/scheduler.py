import logging
import threading
from concurrent.futures import ThreadPoolExecutor as FetchPool
from datetime import datetime, timezone

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app import cache
from app.climate import fetch_all_regions
from app.config import CLIMATE_REFRESH_HOURS, IST, REFRESH_MINUTES
from app.credibility import is_spam
from app.database import SessionLocal
from app.enrich import extract_image, fetch_meta_description, normalize_title
from app.models import ClimateReading, NewsArticle, TradeFlow
from app.news import fetch_market_news
from app.prices import refresh_fx_rates, seed_quotes_if_empty
from app.physical import sync_physical_prices
from app.sgx import sync_sgx_quotes
from app.shanghai import sync_shanghai_quotes
from app.analyzer import build_summary, extract_key_points
from app.news_scraper import is_market_news, iter_niche_query_batches
from app.rss_wire import fetch_article_page, fetch_full_text, iter_rss_batches
from app.eurostat import iter_eurostat_batches
from app.trade_data import iter_trade_batches
from app.translate import translate_article_if_needed

logger = logging.getLogger("market_intel")

_scheduler: BackgroundScheduler | None = None
_scheduler_running = False

# Simple in-memory "is it actually alive" status, surfaced via /api/status —
# this is what proves the 24/7 claim rather than just asserting it.
_last_scrape_at: datetime | None = None
_last_scrape_added: int = 0
_last_climate_at: datetime | None = None
_last_trade_at: datetime | None = None
_last_trade_records: int = 0


def is_scheduler_running() -> bool:
    return _scheduler_running


def get_scrape_status() -> dict:
    return {
        "last_scrape_at": _last_scrape_at.isoformat() if _last_scrape_at else None,
        "last_scrape_added": _last_scrape_added,
        "last_climate_at": _last_climate_at.isoformat() if _last_climate_at else None,
        "last_trade_at": _last_trade_at.isoformat() if _last_trade_at else None,
        "last_trade_records": _last_trade_records,
        "refresh_minutes": REFRESH_MINUTES,
    }


def run_trade_job() -> None:
    """Official UN Comtrade customs data for HS 4001 (natural rubber).

    Committed batch-by-batch like the news scraper — a full pass is ~60
    paced requests over a couple of minutes, and a mid-pass failure should
    cost one period, not the whole archive. Records are upserted on
    (reporter, partner, flow, freq, period) because Comtrade revises past
    figures; a refresh must correct them, not duplicate them."""
    global _last_trade_at, _last_trade_records
    logger.info("Running trade data refresh (UN Comtrade, HS 4001)")
    total = 0

    # Both official sources in one job: Comtrade for global depth, Eurostat
    # for monthly currency. They share the same table and upsert key, and
    # are told apart by the `source` column.
    def all_batches():
        yield from iter_trade_batches()
        yield from iter_eurostat_batches()

    for label, rows in all_batches():
        if not rows:
            continue
        db = SessionLocal()
        try:
            for row in rows:
                existing = (
                    db.query(TradeFlow)
                    .filter(
                        TradeFlow.reporter_code == row["reporter_code"],
                        TradeFlow.partner_code == row["partner_code"],
                        TradeFlow.flow == row["flow"],
                        TradeFlow.freq == row["freq"],
                        TradeFlow.period == row["period"],
                        TradeFlow.hs_code == row["hs_code"],
                        TradeFlow.source == row.get("source", "un-comtrade"),
                    )
                    .first()
                )
                if existing:
                    existing.value_usd = row["value_usd"]
                    existing.qty_kg = row["qty_kg"]
                    existing.is_estimated = row["is_estimated"]
                    existing.fetched_at = datetime.now(timezone.utc)
                else:
                    db.add(TradeFlow(**row))
                    total += 1
            db.commit()
            cache.invalidate_all()
            logger.info("Trade batch committed: %s (%d rows)", label, len(rows))
        except Exception:
            logger.exception("Trade batch failed: %s — continuing", label)
            db.rollback()
        finally:
            db.close()

    _last_trade_at = datetime.now(timezone.utc)
    _last_trade_records = total
    logger.info("Trade refresh complete: %d new records", total)


def run_climate_job() -> None:
    """Real rainfall data from Open-Meteo — no cost, safe to run often."""
    global _last_climate_at
    logger.info("Fetching climate data for all producing regions")
    readings = fetch_all_regions()
    db = SessionLocal()
    try:
        for r in readings:
            db.add(
                ClimateReading(
                    region=r["region"],
                    reading_date=r["reading_date"],
                    rainfall_mm=r["rainfall_today_mm"],
                    rainfall_7d_avg_mm=r["rainfall_7d_avg_mm"],
                    forecast_7d_mm=r.get("forecast_7d_mm", 0.0),
                    disruption_score=r["disruption_score"],
                    source="open-meteo",
                )
            )
        db.commit()
        cache.invalidate_all()
        _last_climate_at = datetime.now(timezone.utc)
        logger.info("Climate data saved for %d regions", len(readings))
    except Exception:
        logger.exception("Climate job failed")
        db.rollback()
    finally:
        db.close()


def run_news_scrape_job() -> None:
    """Real news, zero cost: Google News RSS + GDELT (always) + NewsAPI.org (if a key is set).
    Every individual query is isolated (see news_scraper) so one bad fetch never
    stops the rest of the pass, and results are committed batch-by-batch as
    they come in — a crash or restart mid-pass only loses the current batch,
    not everything gathered so far, and stories appear on the site as soon as
    each query resolves rather than only after the whole pass finishes."""
    global _last_scrape_at, _last_scrape_added
    logger.info("Running news scrape across all niche queries")
    total_added = 0

    def commit_batch(batch: list[dict]) -> None:
        nonlocal total_added
        if not batch:
            return
        db = SessionLocal()
        try:
            # Cheap dedup pass first (URL only, no network calls) so we never
            # waste a translation/summary fetch on an article we're about to
            # discard as an exact-URL repeat.
            urls = {a["url"] for a in batch}
            existing_urls = {row[0] for row in db.query(NewsArticle.url).filter(NewsArticle.url.in_(urls)).all()}
            seen_urls: set[str] = set()
            candidates = []
            for a in batch:
                if a["url"] in existing_urls or a["url"] in seen_urls:
                    continue
                # Genuine-news gate: press-release wires and report-seller
                # product pages never make it into the database at all.
                if is_spam(a.get("source_name", ""), a.get("title", "")):
                    continue
                seen_urls.add(a["url"])
                candidates.append(a)

            # Full article text via Jina Reader, for anything that isn't a
            # Google News redirect (Jina blocks that domain, and Google won't
            # resolve it anyway). Full text is what makes bullet points
            # possible — a meta description only ever yields one sentence.
            readable = [a for a in candidates if "news.google.com" not in a["url"]]
            if readable:
                with FetchPool(max_workers=4) as pool:
                    texts = pool.map(lambda a: fetch_full_text(a["url"]), readable)
                    for a, full_text in zip(readable, texts):
                        if not full_text:
                            continue
                        points = extract_key_points(full_text)
                        if points:
                            a["key_points"] = "\n".join(points)
                        if not a.get("description"):
                            a["description"] = build_summary(full_text, a.get("description", ""))[:400]

            # Lead images, same real-URL population. A card with neither
            # bullets nor an image is just a headline floating in dead
            # space — this is what fills it.
            if readable:
                with FetchPool(max_workers=6) as pool:
                    pages = pool.map(lambda a: fetch_article_page(a["url"]), readable)
                    for a, page in zip(readable, pages):
                        if page:
                            image = extract_image(page, a["url"])
                            if image:
                                a["image_url"] = image

            # Meta-description fallback for whatever still has no summary
            # (Google-redirect articles, and pages Jina couldn't render).
            need_desc = [a for a in candidates if not a.get("description")]
            if need_desc:
                with FetchPool(max_workers=6) as pool:
                    descriptions = pool.map(lambda a: fetch_meta_description(a["url"]), need_desc)
                    for a, meta_desc in zip(need_desc, descriptions):
                        if meta_desc:
                            a["description"] = meta_desc

            # Enrich survivors: translation. Title normalization for the
            # *next* dedup pass must happen on the same (post-translation)
            # text we're about to store — a bug we hit: checking dedup
            # against the original-language title while storing the
            # translated one meant non-English duplicates never matched
            # on later runs.
            for a in candidates:
                title, description, original_language = translate_article_if_needed(a["title"], a.get("description", ""))
                a["title"] = title
                a["description"] = description
                a["original_language"] = original_language
                a["title_normalized"] = normalize_title(title)

            # Cross-source title dedup: the same story can reach us from both
            # Google News and GDELT under different URLs.
            normalized_by_market: dict[str, set[str]] = {}
            for a in candidates:
                normalized_by_market.setdefault(a["market_tag"], set()).add(a["title_normalized"])
            existing_titles: set[tuple[str, str]] = set()
            for market, titles in normalized_by_market.items():
                rows = (
                    db.query(NewsArticle.title_normalized)
                    .filter(NewsArticle.market_tag == market, NewsArticle.title_normalized.in_(titles))
                    .all()
                )
                existing_titles.update((market, row[0]) for row in rows)

            seen_titles: set[tuple[str, str]] = set()
            for a in candidates:
                title_key = (a["market_tag"], a["title_normalized"])
                if title_key in existing_titles or title_key in seen_titles:
                    continue
                seen_titles.add(title_key)
                db.add(NewsArticle(**a))
                total_added += 1
            db.commit()
            if seen_titles:
                cache.invalidate_all()
        except Exception:
            logger.exception("Failed to commit a news batch — continuing with the rest of the pass")
            db.rollback()
        finally:
            db.close()

    try:
        # Publisher RSS first: these carry real article URLs, so they are the
        # ones that can actually produce bullet points. Running them ahead of
        # the Google-News-backed queries also means title-dedup keeps the
        # readable copy of any story both sources carry.
        for label, batch in iter_rss_batches():
            kept = [a for a in batch if is_market_news(a["title"], a["description"], a["market_tag"])]
            logger.info("RSS batch %s: %d of %d are market news", label, len(kept), len(batch))
            commit_batch(kept)

        for batch in iter_niche_query_batches():
            commit_batch(batch)

        for market in ("TSR20", "EURUSD"):
            commit_batch(fetch_market_news(market))

        _last_scrape_at = datetime.now(timezone.utc)
        _last_scrape_added = total_added
        logger.info("News scrape pass complete: %d new articles", total_added)
    except Exception:
        logger.exception("News scrape job failed — the next scheduled pass will retry automatically")


def run_fx_job() -> None:
    """Live FX rates from open.er-api.com — free, no key, one request per pass."""
    db = SessionLocal()
    try:
        updated = refresh_fx_rates(db)
        logger.info("FX refresh: %d pairs updated", updated)
    except Exception:
        logger.exception("FX job failed")
    finally:
        db.close()


def run_sgx_job() -> None:
    """Delayed TSR20 board straight from SGX's own public endpoint — the same
    ~10-minute-delayed numbers the exchange website shows."""
    db = SessionLocal()
    try:
        updated = sync_sgx_quotes(db)
        logger.info("SGX sync: %d contract months updated", updated)
    except Exception:
        logger.exception("SGX sync failed — board keeps its last values")
        db.rollback()
    finally:
        db.close()


def run_shanghai_job() -> None:
    """Shanghai INE TSR20 (NR) board via Sina's quote feed — one request."""
    db = SessionLocal()
    try:
        updated = sync_shanghai_quotes(db)
        logger.info("Shanghai NR sync: %d contract months", updated)
    except Exception:
        logger.exception("Shanghai NR sync failed — board keeps last values")
        db.rollback()
    finally:
        db.close()


def run_physical_job() -> None:
    """Rubber Board of India daily spot prices — published once a day, so a
    few pulls a day is plenty."""
    db = SessionLocal()
    try:
        written = sync_physical_prices(db)
        logger.info("Physical prices sync: %d new rows", written)
    except Exception:
        logger.exception("Physical prices sync failed — keeping last values")
        db.rollback()
    finally:
        db.close()


def _check_and_run_startup_jobs() -> None:
    db = SessionLocal()
    try:
        has_news = db.query(NewsArticle).first() is not None
        has_climate = db.query(ClimateReading).first() is not None
    finally:
        db.close()

    db = SessionLocal()
    try:
        has_trade = db.query(TradeFlow).first() is not None
    finally:
        db.close()

    db = SessionLocal()
    try:
        seed_quotes_if_empty(db)
    except Exception:
        logger.exception("Futures board seed failed")
    finally:
        db.close()
    threading.Thread(target=run_fx_job, daemon=True).start()
    threading.Thread(target=run_sgx_job, daemon=True).start()
    threading.Thread(target=run_shanghai_job, daemon=True).start()
    threading.Thread(target=run_physical_job, daemon=True).start()

    if not has_news:
        logger.info("No news found on startup, running an initial scrape")
        threading.Thread(target=run_news_scrape_job, daemon=True).start()
    if not has_climate:
        threading.Thread(target=run_climate_job, daemon=True).start()
    if not has_trade:
        logger.info("No trade data found on startup, running an initial Comtrade pull")
        threading.Thread(target=run_trade_job, daemon=True).start()


def start_scheduler() -> None:
    global _scheduler, _scheduler_running

    _scheduler = BackgroundScheduler(
        timezone=IST,
        executors={"default": ThreadPoolExecutor(max_workers=2)},
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60},
    )

    # Runs forever, every REFRESH_MINUTES, for as long as the process is alive —
    # this *is* the "24/7, never stops" scraper. coalesce+max_instances=1 mean
    # a slow pass just delays the next one rather than stacking up.
    _scheduler.add_job(
        run_news_scrape_job,
        IntervalTrigger(minutes=REFRESH_MINUTES, timezone=IST),
        id="news_scrape_job",
        replace_existing=True,
    )

    # Real Open-Meteo rainfall data — cheap, refresh a few times a day.
    _scheduler.add_job(
        run_climate_job,
        IntervalTrigger(hours=CLIMATE_REFRESH_HOURS, timezone=IST),
        id="climate_job",
        replace_existing=True,
    )

    # Official customs data revises slowly (Comtrade publishes monthly with a
    # reporting lag), so a twice-daily pull is plenty — hammering it more
    # often would just re-fetch identical rows.
    _scheduler.add_job(
        run_trade_job,
        IntervalTrigger(hours=12, timezone=IST),
        id="trade_job",
        replace_existing=True,
    )

    # Poll SGX every minute and apply every pass straight to the board — the
    # only latency left is the source's own (SGX's free feed is ~10-min
    # delayed by the exchange; real-time is a paid license, and every free
    # aggregator redistributes this same delayed feed).
    _scheduler.add_job(
        run_sgx_job,
        IntervalTrigger(minutes=1, timezone=IST),
        id="sgx_job",
        replace_existing=True,
    )

    # Shanghai INE NR quotes via Sina — live feed, every minute like SGX.
    _scheduler.add_job(
        run_shanghai_job,
        IntervalTrigger(minutes=1, timezone=IST),
        id="shanghai_job",
        replace_existing=True,
    )

    # Rubber Board publishes once daily — refresh every 4 hours to catch the
    # day's numbers whenever they land.
    _scheduler.add_job(
        run_physical_job,
        IntervalTrigger(hours=4, timezone=IST),
        id="physical_job",
        replace_existing=True,
    )

    # Yahoo spot quotes are real-time — a 1-minute pull keeps the FX strip
    # and EUR/USD tick history genuinely live.
    _scheduler.add_job(
        run_fx_job,
        IntervalTrigger(minutes=1, timezone=IST),
        id="fx_job",
        replace_existing=True,
    )

    _scheduler.start()
    _scheduler_running = True
    logger.info("Scheduler started — news every %d min, climate every %d h", REFRESH_MINUTES, CLIMATE_REFRESH_HOURS)

    threading.Thread(target=_check_and_run_startup_jobs, daemon=True).start()


def shutdown_scheduler() -> None:
    global _scheduler_running
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
    _scheduler_running = False
