# The Research Wire — TSR20 + EUR/USD News Wall

A real, 24/7 news site for two markets — **SGX SICOM TSR20 natural rubber futures** and **EUR/USD forex** — built on **Python (FastAPI)** + **React (Vite)**, standalone from the rest of this repo's Node/pnpm workspace.

**Zero AI cost.** Every story is scraped from real outlets (Google News RSS, GDELT, optionally NewsAPI.org) — nothing is written or synthesized by a language model. Climate data is real (Open-Meteo). The Climate & Supply Watch "predictions" are a transparent rule-based composite over real numbers, not an AI model. There is no Anthropic dependency anywhere in this app.

Research/display only. No trading, order placement, or brokerage features.

## History

This app went through five iterations:
1. A Node/Express/TypeScript + Postgres build (`artifacts/api-server` + `artifacts/market-intel` at the repo root) using Claude to write AI-synthesized "analysis" articles.
2. A Python/React rebuild (this directory) with the same AI-analysis approach, plus a news-website redesign and an Analysis section mixing real data (Open-Meteo) with AI-extracted estimates.
3. The Anthropic dependency was removed entirely (API cost was the reason) and replaced with real web scraping. Flash Wire, Weekly Digest, and Scorecard were dropped — they only existed because an LLM was writing them.
4. Split into two dedicated per-market **News Walls** (`/wall/tsr20`, `/wall/eurusd`), the scraper was made to run continuously (every `REFRESH_MINUTES`, default 10, forever — see [24/7 scraping](#247-scraping) below), data sources were broadened (GDELT added, country-tagging added), and Climate Watch got a real rule-based signal engine that combines climate + news into a per-region risk outlook.
5. **This version**: fixed a real bug where EUR/USD disruption news could leak into the (rubber-only) Climate & Supply Watch page; widened country coverage to every real natural-rubber producer, not just the 7 with climate readings; added local language detection + free machine translation so non-English headlines (Chinese, Korean, Spanish, etc.) show up in English; added cross-source title-based dedup (URL-only dedup wasn't enough — the same story reaches us from both Google News and GDELT under different URLs); and articles now carry a real summary pulled from their own page's meta description, not just the headline.

## Where the data comes from

| Data | Source | Cost |
|---|---|---|
| News (headlines, trade/export coverage, disruption alerts) | **Google News RSS** + **GDELT** — both free, no API key, no signup | Free |
| Supplementary news | **NewsAPI.org** — optional, free dev tier | Free (needs a key) |
| Article summaries | Each article's own `og:description` / `meta description` tag, fetched from its source page | Free |
| English translation of non-English articles | Local language detection (`langdetect`) + **MyMemory** free translation API | Free (or free-with-email for a higher quota) |
| Rainfall / disruption score per producing region | **Open-Meteo** — free, no API key | Free |
| Port vessel traffic | **MarineTraffic** embed iframes | Free |

No API key is required to run this app at all. `NEWS_API_KEY` and `TRANSLATE_EMAIL` are both optional quota-boosters, not requirements.

### Translation

Language detection runs fully locally and for free (`langdetect`, no network call) and is deliberately conservative: it only acts on non-Latin script (Chinese, Korean, Arabic, etc.) with normal confidence, or on Latin-script text that's both long enough (25+ chars) and high-confidence (≥90%). We hit a real accuracy bug during development — short English titles like "Singapore Exchange (SGX)" were being misdetected as Tagalog or Romanian and needlessly round-tripped through translation. The fix (`translate.py::detect_language`) requires non-Latin script as a high-confidence signal on its own, but treats Latin-script "foreign language" verdicts skeptically unless the text is long and the detector is confident. When a translation happens, the article's `original_language` is stored and shown as a small "translated" tag in the UI — nothing is silently rewritten without disclosure.

## 24/7 scraping

The scraper isn't a one-shot job — it's an APScheduler `IntervalTrigger` that fires every `REFRESH_MINUTES` (default 10) for as long as the backend process is alive, with `coalesce=True, max_instances=1` so a slow pass just delays the next one instead of stacking up. Every one of the ~25 niche queries is fetched independently and **committed to the DB as soon as it resolves** (not batched until the end of a pass) — so:

- A crash or restart mid-pass only loses the current query's batch, not everything gathered since the last full run.
- Fresh stories appear on the site progressively as each query resolves, not only after a multi-minute pass finishes.
- `GET /api/status` exposes `last_scrape_at` / `last_scrape_added` / `last_climate_at` — the header's "Last scraped Xm ago" indicator reads directly from this, so the 24/7 claim is checkable, not just asserted.

GDELT's free endpoint rate-limits rapid sequential requests (`429`s) — there's a deliberate pause between GDELT calls (see `news_scraper.iter_niche_query_batches`) so a pass mostly gets real data back instead of getting throttled. If you add more sources, follow the same pattern: yield per-query, isolate failures per-source, never let one bad source block the rest.

## 24/7 scraping — extending it

The whole point of the `NICHE_QUERIES` dict in `news_scraper.py` and `PRODUCING_COUNTRIES` list is that adding more coverage is additive, not a rewrite: append a `(query, category)` tuple to widen search coverage, or add a new `fetch_*` function following the same shape (`list[dict]` with `title`/`url`/`description`/`source_name`/`country`/`published_at`) to add a whole new source, then call it from `iter_niche_query_batches`.

## Stack

- **Backend**: Python 3.11+, FastAPI, Uvicorn, SQLAlchemy 2.0, SQLite, APScheduler (`BackgroundScheduler`, `Asia/Kolkata`), `httpx`, `defusedxml` (safe RSS parsing)
- **Frontend**: React 18 + Vite + TypeScript, Tailwind CSS v4, TanStack Query, React Router, lucide-react icons
- Editorial dark design system built directly in code (see [Design](#design) below)

## Run locally

### Backend

```bash
cd market-intel-v2/backend
python -m venv .venv
.venv/Scripts/activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env          # optional: add NEWS_API_KEY for a third news source
uvicorn app.main:app --reload --port 8020
```

### Frontend

```bash
cd market-intel-v2/frontend
npm install
npm run dev                   # http://localhost:5173, proxies /api to :8020
```

Nothing needs to be configured before it runs — the scheduler scrapes real news and climate data on first startup automatically, then keeps going every `REFRESH_MINUTES` for as long as the process stays up.

## Where things live

- `backend/app/markets.py` — `MARKETS` and `PORTS` config
- `backend/app/news_scraper.py` — Google News RSS + GDELT scraper: niche query sets per market/category, country detection, HTML-stripping, dedup, the `iter_niche_query_batches` generator that powers incremental commits
- `backend/app/news.py` — optional NewsAPI.org supplementary client
- `backend/app/climate.py` — Open-Meteo integration + the disruption-score heuristic (our own, not an official index)
- `backend/app/signals.py` — the rule-based supply-risk composite: real rainfall anomaly + real matched disruption-article counts → per-region risk level + rationale + market-wide outlook. Not AI, not a price forecast — every number is auditable
- `backend/app/scheduler.py` — APScheduler jobs: news scrape every `REFRESH_MINUTES` (never stops), climate refresh every `CLIMATE_REFRESH_HOURS`
- `backend/app/models.py` — `NewsArticle` (with `country` tagging), `ClimateReading` — the entire data model, two tables
- `backend/app/routers/` — `news`, `analytics` (climate + signals + disruption alerts), `ports`, `status`
- `frontend/src/pages/Dashboard.tsx` — the combined News Wall overview (both markets)
- `frontend/src/pages/NewsWallMarket.tsx` — the dedicated single-market wall (`/wall/tsr20`, `/wall/eurusd`)
- `frontend/src/components/FeedRow.tsx` — the shared real-news list item, links out to the original source

## Frontend pages

| Section | Page | Route | Purpose |
|---|---|---|---|
| News Wall | Overview | `/` | Real lead story + wire feed across both markets, auto-refreshes every 60s |
| News Wall | TSR20 Rubber | `/wall/tsr20` | Dedicated real-time wall for TSR20 only |
| News Wall | EUR/USD | `/wall/eurusd` | Dedicated real-time wall for EUR/USD only |
| News Wall | Archive | `/history` | Every scraped story, filterable by market and category |
| Analysis | Trade & Supply | `/analysis/trade-flow` | Real export/trade-bulletin coverage — no fabricated tonnage numbers |
| Analysis | Climate Watch | `/analysis/climate` | Real rainfall + rule-based per-region risk outlook + matched disruption news |
| Analysis | Port Traffic | `/ports` | MarineTraffic iframe embeds for 7 rubber export ports |

Every headline links out to its real source in a new tab — this site doesn't claim to host the full article, just surfaces and organizes it.

## API endpoints

All under `/api`. See `/docs` for the interactive schema once the backend is running.

| Method | Path | Purpose |
|---|---|---|
| GET | `/news/latest/{market}` | Most recent real article |
| GET | `/news/history/{market}?limit=&category=` | Past articles, optionally filtered by category (`headline`/`trade`/`disruption`) |
| GET | `/news/item/{id}` | Single article by ID |
| POST | `/news/refresh` | Manually trigger a scrape |
| GET | `/climate` | Latest real rainfall reading per producing region |
| GET | `/signals/regions` | Rule-based per-region supply-risk composite (climate + matched news) |
| GET | `/signals/outlook` | Market-wide aggregate of the region signals |
| GET | `/supply-alerts` | Real news matching disruption/disease keywords |
| GET | `/ports` | Port config for the live-traffic grid |
| GET | `/status` | System status — scheduler, last scrape/climate timestamps, NewsAPI configured |
| GET | `/news/country-breakdown/{market}?category=` | Real article counts grouped by detected country — powers the Trade & Supply pie chart |

## Front page — video hero + news-card system

Page order, top to bottom: **full-width desk video**, then two card rows, then the market bar, panels and wire.

### Card vocabulary (`NewsCards.tsx`)

Four shapes, matching how a news portal ranks stories by visual weight:

| Component | Shape | Used for |
|---|---|---|
| `FeatureCard` | photo, chip, large headline, source footer | the two lead stories |
| `PhotoTile` | photo with headline over a scrim | the pair topping the right block |
| `ThumbRow` | square thumbnail + two-line headline | the six-row mixed block |
| `TextRow` | headline only | the dense two-column tail |

All four share one rule: a story without an `og:image` never collapses its media slot — it falls back to a market-tinted plate carrying the market code. Only a minority of sources expose an image, and a half-empty card grid reads as broken rather than sparse.

**Slot assignment is image-aware.** Image-bearing stories are offered to the visual slots first (feature cards, photo tiles), with recency ordering inside each group; the text-only rows take whatever remains, since they lose nothing by having no picture.

### Video hero (`VideoHero.tsx`)

Full width, 220px on mobile rising to 420px on desktop, carrying the live desk status (scheduler state + last pull) over the footage. Same loading discipline as before: visibility-gated fetch, `autoPlay` **and** an explicit `play()` after commit, muted/`playsInline` for iOS, `aria-hidden` because it carries nothing the text doesn't, and never fetched under `prefers-reduced-motion`.

Note for anyone debugging playback here: a non-composited browser pane suspends video, so `paused === true` with `readyState === 4` and a non-zero `currentTime` means it played and the *pane* stopped it — not a code fault.

Verified section order and heights at 1440px: video 420 → feature row 498 → text row 427 → market bar 99 → panels 406 → wire 1383. At 375px everything stacks full-width with zero overflow, zero real voids, all images loading.

## Earlier iteration — news-portal mosaic

The Overview opens as an image-led mosaic in the shape of a mainstream news portal: one tall lead tile, one wide tile, two small tiles, each a photo with the headline over a bottom-weighted scrim and a market-coloured category chip.

**Slot filling is image-aware.** Only a minority of sources expose an `og:image`, and picking mosaic stories purely by recency left the front page as mostly fallback plates. Stories that have an image are offered to the mosaic first, with recency deciding order inside each group; anything without one still renders as a market-tinted plate rather than collapsing the tile.

Below the mosaic sits a market bar (four trade figures) and a row of four panels:

| Panel | Source |
|---|---|
| Trending Countries | country mention counts across stored rubber coverage |
| Desk Video | the ambient loop, given a real home |
| Top Categories | live counts per market × category, linking to that wall |
| Supply Risk | rule-based region signals + market outlook |

**The reference layout's fourth panel was a reader poll — that slot carries supply risk instead.** A poll on a site with no accounts and no vote storage would be fabricated engagement, and every other number here is traceable to a source.

Verified at 375px and 1440px: mosaic tiles 436/210/210/210 on desktop and full-width stacked on mobile, all four panels equal height (406px), zero real voids, no horizontal overflow.

## Layout — dense magazine grid

The Overview is a 12-column bento grid modelled on how real news sites use their width, rather than a single centred column with empty margins:

- **Lead story** (7-8 cols) sits over an ambient hero video with an ink wash for headline contrast
- **Right rail** (4-5 cols) stacks market stat tiles, the supply-risk outlook, then secondary story cards
- **Four-across strip** of compact cards below
- **Latest Wire** runs in two columns from `xl` up — a single 20-item list beside a 1600px container left most of the page empty

Container widened from 1240px to **1600px**; every inner page moved from `max-w-3xl`/`4xl` to `max-w-6xl`, and the market walls run two feed columns from `lg` up.

**Responsive verified by measurement at 375 / 768 / 1440**, checking `scrollWidth > innerWidth` and hunting any element wider than the viewport. Zero horizontal overflow at all three; hero type scales 24px → 54px.

### Article images fill the gaps (`enrich.extract_image`)

Every article with a real publisher URL gets its lead image scraped from `og:image` (falling back to `twitter:image`), stored in `image_url`. Sprites, logos, avatars, tracking pixels and placeholder chrome are filtered by filename; relative and protocol-relative URLs are resolved to absolute.

The images do real work rather than decorate: a story with no bullets and no summary previously rendered as a bare headline stranded in a stretched cell. Now the image fills it, feed rows carry a thumbnail like the reference layouts, and cards fall back gracefully — a broken image URL hides itself via `onError` instead of leaving a torn placeholder.

### The empty-space bug — two causes, two different fixes

The tall voids between stories were never missing data. They were two separate CSS layout faults, and the first fix only solved half of it.

**1. Feed lists → CSS multi-column, not grid.** Grid lays items out in *rows*: a row cannot begin until the tallest cell in the previous row ends, so a four-bullet story left a tall gap beneath the headline-only story next to it. `align-items: start` stopped the short cell *stretching* but could not close the gap — the row height itself was the problem. Multi-column (`columns-2`) flows content continuously down each column instead, with `break-inside-avoid` keeping a story intact. The ragged edge now appears only once, at the very bottom.

**2. Card strips → a uniform media slot.** Only some articles carry an `og:image`, so cards with one stood ~130px taller than their neighbours and the four-across strip had a ragged bottom edge. Every card now renders a fixed-height media slot: the real image when there is one, otherwise a market-tinted plate carrying the market code — filling the space without inventing imagery. With the slot uniform, the cards stretch to equal height safely.

Verified by measurement rather than by eye. A "real void" is defined as an element whose height exceeds the sum of its children's by more than 60px:

| Check | 768px | 1440px |
|---|---|---|
| Real voids | 0 | 0 |
| Four-across strip bottoms aligned | yes | yes (all 4 at 343px, identical bottom) |
| Horizontal overflow | none | none |

Worth noting for future debugging: a naive "tall element with little text" heuristic reports false positives here — a card is legitimately 343px when a 128px image slot sits above 213px of body. Measure the unaccounted space, not the text length.

### Hero video (`HeroVideo.tsx`)

The ~17MB file is gated behind an IntersectionObserver so it is never fetched until the hero is on screen — it can't block first paint or burn mobile data on a bounce. Muted + `playsInline` (iOS refuses autoplay otherwise), `aria-hidden` (it is decoration; every fact is in the text), and never fetched at all under `prefers-reduced-motion`.

Two bugs were fixed here that both left the video silently dead at `readyState 0`:

- **Competing position classes** — the component set `relative` on its own root while the caller passed `absolute inset-0`. Two `position` rules whose winner depended on Tailwind's stylesheet order, not intent. The root no longer sets position; the caller owns it
- **`play()` called a frame too early** — it ran inside the observer callback, but `setState` is async, so the element still had no `src` and the promise rejected silently. Playback now happens in a second effect keyed on the load gate, after React has committed the `<video>`

Verified live: `1600x1200`, 20s, `readyState 4`, playing.

> **Worth compressing.** 17MB is heavy for a hero asset even lazily loaded. `ffmpeg -i hero.mp4 -vf scale=1280:-2 -crf 30 -an hero.mp4` would cut it substantially with no visible loss at this size.

## Design

**Light editorial paper.** Warm cream ground (`#F7F4EE`), deep ink text, market-coded forest green and ink blue, antique gold accent. Cream rather than pure white deliberately — a `#FFF` ground makes long-form reading harsher and turns the gold accent muddy.

**Every colour pair was measured in the browser, not eyeballed.** The first pass shipped two AA failures (`text-faint` at 4.42:1, `accent` at 4.05:1); both were darkened until they cleared. Current ratios against the paper ground:

| Token | Hex | Contrast | |
|---|---|---|---|
| text | `#14100C` | 17.24:1 | PASS |
| text-dim | `#574F44` | 7.33:1 | PASS |
| text-faint | `#736A5E` | 4.84:1 | PASS |
| accent | `#8A6118` | 5.03:1 | PASS |
| tsr20 | `#2F6B4F` | 5.73:1 | PASS |
| eurusd | `#2B4C7E` | 7.84:1 | PASS |

Going light meant more than swapping tokens — chart palettes, map tiles and the grain overlay all had to be re-derived:

- **Chart colours darkened across the board.** Hues tuned to glow on near-black wash out completely on cream. Sequential ramps within one hue family for the race chart (rank is already carried by bar length), maximally separable hues for the categorical pie
- **Map switched to CARTO light tiles**, with Leaflet's own chrome (attribution, zoom controls) forced onto the paper palette so it stops punching a white hole in the page
- **Grain overlay now `mix-blend-mode: multiply`** at 3.5% — on a light ground an additive grain reads as grey film sitting on top, rather than fibre in the stock

Typography is unchanged and still the star: **Fraunces** (variable optical-size serif) for masthead and headlines, **Instrument Sans** for body, **JetBrains Mono** for timestamps, kickers and figures.

Motion: masthead letters rise out of overflow masks, a **hero rule draws itself out from the centre** once they land, section content enters on a blur-resolving fade-up via IntersectionObserver, and links carry a sweeping underline. All of it animates only transform/opacity/filter and is fully disabled under `prefers-reduced-motion`.

### Previously — "dark newsroom at press time"

The prior dark theme, kept here for reference since the structure carried over:

- **Fraunces** (variable optical-size serif) for the masthead and all headlines, **Instrument Sans** for body, **JetBrains Mono** confined to timestamps/numbers/kickers
- **Market-coded color as information**: every TSR20 story reads latex-green, every EUR/USD story euro-blue — tags, nav underlines, ticker labels, hover rules all follow. The market of any story is legible from color alone
- **Kinetic typography**: masthead letters and lead headlines rise out of overflow masks with a per-word/letter stagger (`.mask-rise`, keyed to the text so a new lead replays the reveal); sections below the fold enter with a blur-resolving fade-up (`useReveal` + IntersectionObserver — callback ref, not a mount effect, because reveal targets mount after data loads)
- A fixed film-grain overlay (`.grain`, inline SVG noise at 5% opacity, pointer-events off), sweep underlines on read-more links, spring-feel `cubic-bezier(0.32,0.72,0,1)` on all transitions
- Every animation honors `prefers-reduced-motion` and animates only transform/opacity/filter

Design tokens live in `frontend/src/index.css` under `@theme`.

## Architecture decisions

- Markets are keyed as `TSR20` and `EURUSD` (no slash) everywhere
- `NewsArticle.category` (`headline` / `trade` / `disruption`) drives which feed a story appears in — set by which niche query matched it, see `NICHE_QUERIES` in `news_scraper.py`
- `NewsArticle.country` is a best-effort keyword match against `PRODUCING_COUNTRIES` in the article's title/description — it's what lets Climate Watch correlate real rainfall data in a region to real news about that region's country. It's approximate (country-level, not the finer producing-region level) and nullable — most articles won't mention a specific country by name
- Articles are deduped by URL **and** by (market, normalized title) — URL-only dedup wasn't enough (a bug we hit: Google News and GDELT often index the identical story under two different URLs, so the same headline showed up twice). `enrich.normalize_title()` lowercases and strips punctuation before comparing. Enrichment (summary fetch + translation) runs *before* the title-dedup check, not after — another bug we hit: checking against the pre-translation title while storing the post-translation one meant non-English duplicates could never match on later runs
- Real summaries: when an article has no description, `enrich.fetch_meta_description()` fetches the article's own page and extracts its `og:description`/`meta description` tag — a genuine per-article network call, capped at a 5s timeout, silently skipped on any failure so it never blocks the pipeline
- News is committed incrementally, per query, not batched to the end of a scrape pass (a robustness fix we made after an early full-batch design lost an entire pass's work when the process was restarted mid-scrape)
- `/api/supply-alerts` and the signals engine are hard-filtered to `market_tag == "TSR20"` — Climate & Supply Watch is a rubber-only page, and both queries used to have no market filter at all, so EUR/USD disruption news (recession risk, CPI surprises) could leak into a rubber-supply page. Fixed by filtering explicitly rather than relying on the country-match happening to exclude it
- Scraper failures are caught and logged at the single-query level; they never crash the scheduler, the API process, or the rest of the pass
- The signals engine (`signals.py`) is intentionally simple arithmetic — climate anomaly score + a capped per-article boost for matched disruption news — so every composite score is explainable from its two disclosed inputs, not a black box
- `.env` loads with `override=True` so this app's own config always wins over anything already set in the parent shell/environment
- No authentication; no trading/order features — research/display only
- **Climate Watch's map** (`ClimateMap.tsx`) uses `react-leaflet` + CARTO's free dark-tile basemap (no key) — markers are colored by the same risk-level palette as the region cards, sized loosely by composite score, auto-fit to the 7 region coordinates (now returned by `GET /climate` as `lat`/`lon`, sourced from `climate.PRODUCING_REGIONS`)
- **The rainfall "today · 7-day avg" figures**: "today" is that single day's Open-Meteo `precipitation_sum`; "7-day avg" is a plain unweighted mean of the trailing 7 daily values (today + previous 6) — no smoothing. This is spelled out in-page on Climate Watch, not just here
- **Recharts is pinned to v2** (`^2.15.4`), not v3 — v3's default `Pie` animation left every sector's `<path>` completely unrendered (0-size, no `d` attribute) under React 18 `StrictMode`'s deliberate double-mount in dev. If you ever see a Recharts chart render an empty/invisible shape with no console error, check `isAnimationActive={false}` on the animated element first
- **Windows dev gotcha**: killing a `uvicorn --reload` process can occasionally leave a "ghost" listening socket — `netstat` shows a PID still bound to the port, but `Get-Process`/`tasklist` says that PID doesn't exist, and a new process on the same port fails with "address already in use." If this happens, don't keep fighting it — just move to a fresh port (update both the `uvicorn --port` and `frontend/vite.config.ts`'s proxy target)

## Performance (backend)

- **SQLite WAL mode + pragmas** (`database.py`): without WAL, every scrape commit briefly blocked all reads (and vice versa), showing up as request stalls whenever a pass landed. `busy_timeout=5000` covers the rare remaining contention
- **Composite indexes** on `(market_tag, published_at)` and `(market_tag, category, published_at)` — the two hot query shapes (wall feed, category feed). Created with `CREATE INDEX IF NOT EXISTS` in `init_db()` because `create_all` only builds indexes for brand-new tables
- **In-process TTL cache** (`cache.py`, 30s) on all hot read endpoints, invalidated after every scrape/climate commit so new data is visible on the very next poll. Every open tab polls the same endpoints every minute; repeated polls now cost a dict lookup (~2ms round-trip measured) instead of a query
- **GZip middleware** — feed responses compress ~5:1
- **Pooled `httpx.Client`s** in `news_scraper.py` and `enrich.py` — keep-alive connection reuse instead of a fresh TLS handshake per query/article
- **Parallel summary fetches** — per-article `og:description` fetches run in a 6-worker thread pool per batch; serially they dominated the whole pass
- **Interleaved market scraping** — queries run TSR20, EURUSD, TSR20, … round-robin instead of all ~21 TSR20 queries first. Before this, EUR/USD only got fresh articles at the tail of every pass, which is why the EUR/USD wall could look stale/empty while TSR20 was already full

## Genuine-news verification (zero AI)

`credibility.py` is a rule-based source-credibility layer:

- **Three visible tiers**: `verified` (global wires, major financial press, official bodies/exchanges), `trusted` (established regional + rubber/FX trade press), `unrated` (real articles from real sites we can't vouch for by name). The API returns the tier per article and the UI shows ✓ verified / ⛨ trusted badges; unrated shows no badge — absence is the signal
- **Hard blocklist, applied at scrape time**: press-release wires (openpr, PRNewswire, GlobeNewswire, …) and market-research report sellers (IndexBox, Mordor, Technavio, …) never enter the database — their "headlines" are ads shaped like news, and they're the main spam that slips through aggregators. Report-shaped titles ("… Market Report 2026 — Size, Share, Forecast") are blocked regardless of domain
- **Relevance gate** (`MARKET_RELEVANCE` in `news_scraper.py`): an article on a market's wall must actually mention that market's subject. Google News items match on title+description (its snippets often carry the subject when the headline doesn't); GDELT items match title-only since GDELT returns no description. This is what stopped GDELT's fuzzy matching from putting a jackfruit-trade story on the rubber wall
- **Broken-translation guard** (`translate.py`): MyMemory occasionally returns fragments ("| in the province of …") for titles it only partially matched — translated titles are stripped of leading junk and rejected (keeping the original) if what remains is shorter than a real headline

## Official trade, supply & demand data (TSR20 only)

The **Trade & Supply** page runs on **two independent official sources**, both free and keyless. They answer different questions and are never merged:

| Source | Coverage | Freshness | Currency |
|---|---|---|---|
| **UN Comtrade** | Every reporting country on earth, deep history | Newest *complete* year runs ~2 years behind | USD |
| **Eurostat COMEXT** | EU27 only, by source country | **Monthly, ~5 months behind** | EUR |

Comtrade gives the global picture; Eurostat gives currency. At the time of writing Comtrade's newest complete year was 2023 while Eurostat had already published **March 2026**.

**They are deliberately never summed.** The values are in different currencies and the reporter universes differ (all countries vs. the EU27), so a combined total would be meaningless. `_scope()` in `trade_analysis.py` pins every query to exactly one source, and a `currency` column travels with each row. No FX conversion is applied anywhere — converting would bake a rate into stored history and silently change past figures on every refresh.

### UN Comtrade specifics

- **Commodity**: HS **4001** (natural rubber in primary forms). TSR20 is a *grade* within it, not its own HS line — 4001 is the finest official granularity that exists globally, and the page says so rather than implying TSR20-exact figures
- **Supply = exports**, **demand = imports**. Stated in-page, not left to inference
- **Three layers pulled**: annual (8 years) for yearly reports, monthly (36 months) for monthly reports and the animated timeline, and bilateral partner breakdown for exporter→importer lanes
- **Everything is archived permanently** in the `trade_flows` table, keyed unique on (reporter, partner, flow, freq, period). Refreshes *upsert* rather than duplicate, because Comtrade revises past figures. Year-over-year depth grows the longer the site runs
- **Refresh cadence**: every 12 hours. Customs data revises slowly — polling harder would just re-fetch identical rows
- **Endpoints**: `/trade/balance`, `/trade/supply`, `/trade/demand`, `/trade/timeline`, `/trade/flows`, `POST /trade/refresh`

### Two data-integrity guards (both caught real bugs in testing)

- **Coverage gate** (`COVERAGE_THRESHOLD = 0.85` in `trade_analysis.py`): Comtrade publishes continuously, so the newest period always *exists* but is near-empty. On first run, 2025 held 6 exporters while 2023 held 17 — and Thailand, the largest exporter on earth, hadn't filed. Ranking that period would have understated global supply by more than half and crowned Indonesia the top exporter, which is false. Periods below 70% of the best-covered period are excluded from every ranking and total
- **Period intersection** in `timeline()`: exporters and importers file on different schedules — monthly import data ran ~13 months ahead of monthly export data. Taking the union produced frames with a full demand column and an empty supply column, which reads as *"supply collapsed to zero"* rather than *"nobody has filed yet"*. The animation only shows periods where both sides reported

### Grades tracked separately (this is what makes it TSR20-accurate)

Rubber trades under four HS subheadings, each pulled and charted on its own — they are separate measurements, never slices of one number:

| HS | Grade | Note |
|---|---|---|
| `400122` | **TSR / TSNR** | **The grade TSR20 belongs to** — technically specified rubber |
| `400121` | Ribbed Smoked Sheets (RSS) | Thailand dominates |
| `400110` | Latex | |
| `400129` | Cup Lumps & Other Primary Forms | See caveat below |

**Cup lumps caveat, repeated in the UI**: field coagulum/cup lump has no dedicated HS line. It is upstream material mostly processed domestically into TSR rather than exported, so `400129` captures only the share that crosses a border — the closest official proxy that exists, not a cup-lump production figure. (Cambodia and Laos lead it, which fits: they export unprocessed field material.)

### Data freshness is shown, not hidden

Customs data is filed with a long lag. At the time of writing the calendar read 2026 while the newest **complete** year was 2023, with 2025 filed by only 5–6 countries. The page shows both — "Complete" (enough reporters to rank and total honestly) and "Latest filed" (newest record of any kind, however thin) — and every ranking uses complete periods only.

### Comtrade API quirks (learned by testing, all cost a debugging round)

- **Rate limiting is silent and grade-ordered.** At 1.5s pacing over a ~200-request pass, Comtrade began returning 429s partway through. Because the grade loop is ordered, the *first* grade got complete data while later ones came back empty — TSR looked perfect while latex and cup lumps had zero annual rows. Nothing errored. Pacing is now 3s with explicit 429 retry/backoff, and per-grade coverage is checked after every pull

- Multiple **reporters** in one request work (`reporterCode=764,360,704`) — this is what keeps a full refresh at ~90 requests instead of thousands
- Multiple **periods** in one request do **not** — one request per period, paced 1.5s
- Omitting `partnerCode` returns the bilateral breakdown; passing `partnerCode=0` returns the world-total aggregate

### Eurostat specifics (`eurostat.py`)

- Dataset `ds-045409` ("EU trade since 1988 by HS2-4-6 and CN8"). **The base path matters**: the usual `/eurostat/api/dissemination/...` host returns 404 for this dataset — COMEXT lives under `/eurostat/api/comext/dissemination/...`
- Indicator codes are `VALUE_IN_EUROS` and `QUANTITY_IN_100KG`. Quantity is converted to kilograms on ingest so one column never mixes units
- All producing countries ride in a single request as repeated `partner=` params, and both indicators in one call — a full pass is 4 grades × 2 flows × 18 months = 144 calls
- Response is JSON-stat: values are keyed by one flattened index across every dimension, so partner and indicator have to be recovered from the declared dimension sizes rather than read off a row
- **Partner codes are the same M49 numbers Comtrade uses.** Not cosmetic: rows are keyed on `(reporter, partner, flow, freq, period, hs_code)`, and the first implementation left `partner_code=0` for every country — so all 18 producing countries collided on one key and the entire first pull died on a UNIQUE constraint

### Sources considered and rejected

- **US Census international trade API** — would be excellent (monthly, ~5 week lag), but now requires a free API key with email signup. Wire it up by adding the key to `.env` if you want US demand data
- **Brazil ComexStat**, **India data.gov.in**, **Indonesia BPS** — either key-gated or return HTML rather than a queryable API
- **World Bank WITS** — returns an HTML error page rather than data on the documented SDMX endpoint

## Key points — bullets under each headline (`analyzer.py`)

Articles now carry 3–4 bullet points, not just a one-line description.

**Extractive, never generative.** Every bullet is a sentence lifted verbatim from the article body. Nothing is paraphrased or inferred — a model-written summary would quietly break the site's "real news, scraped not synthesized" promise. The tradeoff is honest: bullets read like the source, because they are the source.

Sentences are scored for what a commodity desk actually reads for — percentages, prices, tonnage, market verbs (rose/fell/exports/output), named countries, named institutions (ECB, Fed, ANRPC, SGX) — with a lead bias, and boilerplate (cookie notices, author bios, disclaimers) scored out. Only sentences clearing a score floor become bullets, so a thin article shows none rather than arbitrary prose.

### Where the full text comes from

`agent-reach doctor --json` reports exactly two zero-config channels on this machine: **rss** (feedparser) and **web** (Jina Reader). Both are used; nothing depends on the channels that need a browser login (Twitter, Reddit, LinkedIn, YouTube, Instagram, Facebook, Xiaohongshu) or a missing CLI (GitHub, Exa).

- **Publisher RSS** (`rss_wire.py`) gives direct article URLs — the thing Google News withholds
- **Jina Reader** (`https://r.jina.ai/<url>`, free, no key) returns the whole article as clean markdown

**Coverage is honestly partial: ~18 of 406 articles have bullets.** The limit is Google News, which encodes its target URLs and blocks resolution — Jina rejects `news.google.com` outright with an abuse error, exactly as its own redirect resolver did. Articles reaching us through GDELT or publisher RSS have real URLs and do get bullets; Google-sourced ones can't, and that is a hard external limit, not a bug to fix.

### The gate that keeps walls on-topic (`is_market_news`)

Broad feeds carry far more noise than targeted Google queries, so feed items must clear three checks the query results don't:

- **Market signal required** — a price, volume, flow, or supply/demand word. Tyre-industry PR (factory openings, executive appointments, sponsorships, ESG index inclusions) mentions "rubber" constantly and says nothing about the market
- **Synthetic rubber excluded from TSR20** — LSR, SBR, halobutyl, EPDM and neoprene are different commodities with different economics; they were arriving purely because "rubber" appears in them
- **EUR/USD must name the pair** — FXStreet publishes every currency, so AUD/NZD/CAD/GBP stories sailed onto the EUR/USD wall under generic words like "inflation" and "central bank". A headline naming another pair is only kept if it names the euro too

Verified with an 11-case test covering both directions; 52 off-market articles were purged retroactively when the gate landed.

## Interactivity (frontend)

- **Headline ticker** (`Ticker.tsx`) under the masthead — freshest stories from both walls, CSS-only marquee (two duplicated halves scrolling −50% for a seamless loop), pauses on hover, stands still under `prefers-reduced-motion`
- **Client-side search** on each wall — filters title/description/source as you type, with a live match counter
- **Country filter chips** — derived from the wall's own articles (top 8 detected countries with counts); TSR20 gets a full row, EUR/USD naturally shows none
- **"N new stories" pill** — each wall tracks the newest article id across background refetches; when a scrape lands new stories, a pill rises from the bottom instead of the list silently reshuffling under the reader. Clicking scrolls to top and acknowledges
- **Live relative timestamps** — `useNow()` re-renders every 30s so "3m ago" stays honest while a tab sits open
- **Skeleton loaders** (`Skeleton.tsx`) shaped like the feed rows, so the page keeps its structure while loading instead of collapsing into a spinner
- **Row micro-interactions** — hover slides a gold left-rule in; all motion respects `prefers-reduced-motion`
