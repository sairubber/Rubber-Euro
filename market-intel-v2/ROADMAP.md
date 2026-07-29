# The Rubber Desk — New Tabs Roadmap

Distilled from Gemini brainstorm (July 2026). Filter applied: only features with **real, free/cheap data sources** that fit the existing stack (FastAPI + React, Render + Vercel). Fiction and enterprise-paid-API features parked at the bottom.

Existing tabs (already built, not repeated here): Dashboard, Prices (SGX + Shanghai boards), TradeFlow, PortTraffic, ClimateWatch, NewsWall, Archive.

---

## Tier 1 — Build now (free data, high desk value)

### 1. Basis & Spreads tab
The single most valuable hedging-desk feature from the whole conversation.
- **Physical Basis** = Physical FOB spot − SGX TSR20 futures (futures already scraped)
- **Grade spread**: RSS3 − TSR20
- **Origin spread**: STR20 (Thailand) vs SIR20 (Indonesia) vs SVR (Vietnam)
- **Data**: RAOT Thailand daily prices (raot.co.th, public), Rubber Board India daily prices (rubberboard.org.in, public), MRB Malaysia (lgm.gov.my, public). SGX side already in DB.
- Chart: basis history line + current spread matrix.

### 2. Farm-Gate / Origin tab
Upstream cost floor — tells the desk when processors stop buying.
- Hat Yai market: Cup Lump, USS, raw latex daily rates (RAOT publishes free)
- Kerala/Kottayam RSS4, RSS5, latex — **backend parser already exists** (physical.py, Rubber Board India); frontend card was removed, revive it here
- Processor Margin indicator = STR20 FOB − (cup lump cost + processing estimate)
- Tapping calendar strip: Wintering (Feb–Apr) / Peak (Oct–Dec) status per region

### 3. FX Desk panel — MOSTLY DONE
FX strip already live (Google Finance scrape, 5 pairs, 1-min poll). Remaining: add USD/VND + USD/IDR if missing, 30-day sparklines. No new tab needed.

### 4. Forward Curve view
Zero new data needed — 5 delivery months per exchange already in DB.
- Contango/backwardation curve chart (SGX TSR20 + SHFE RU/NR side by side)
- Roll yield readout between front and next month
- Could live inside Prices tab as a sub-view

### 5. Landed Cost Calculator tab
Pure client-side calculator, no data feed.
- Inputs: FOB price, freight/MT, duty %, inland trucking, insurance
- Output: total landed cost $/kg and per MT
- Preset duty rates per destination country (static table, editable)

### 6. Tapping Disruption indicator (upgrade to ClimateWatch, not a new tab)
- Logic: morning rainfall > 2 mm in a rubber belt = "No Tapping Day" flag
- Belts: Surat Thani, Songkhla, North Sumatra, Binh Duong, Kottayam
- **Data**: Open-Meteo (already integrated for climate) — just add the rule + badge

---

## Tier 2 — Build next (free data exists, more work)

### 7. Warehouse Stocks tab — BUILT (2026-07-29)
- INE NR (TSR20) on-warrant stocks, DAILY, via East Money datacenter API (SHFE/INE sites WAF-block direct scraping)
- Live at /desk/stocks. RU (whole-latex SHFE contract) deliberately excluded — TSR20 only
- Qingdao bonded stocks are paid (Mysteel) — not shown rather than estimated

### 8. Vessel Watch tab — BUILT (2026-07-29)
- aisstream.io websocket (user's free key, AISSTREAM_KEY env), live at /desk/vessels
- Coverage probed: Singapore Strait corridor streams live; the 7 origin/discharge port boxes have NO free-receiver
  coverage today — subscribed anyway, honestly labelled, fills if receivers appear
- Ships-not-cargoes honesty note on the page

### 9. Desk Bulletin tab — BUILT (2026-07-29)
- /desk/bulletin: futures + curve + exchange spread, physical basis, warrant stocks window position, tapping/rain,
  ENSO (NOAA ONI, free), FX board, 24h headlines — all rule-based assembly, no model text
- Still open: CSV/PDF export button

### 10. Export & Reports (cross-cutting, not a tab)
- One-click CSV export on every data table
- Print-friendly PDF of the Desk Bulletin

---

## Tier 3 — Possible but heavy (do after Tier 1–2 proven)

- **B/L PDF parser**: upload bill of lading, OCR (Tesseract) extracts container ID, vessel, tonnage — free tech, medium effort
- **Email alerts**: price threshold / no-tapping-day alerts via SMTP (free); WhatsApp needs Twilio (paid)
- **Scenario calculator**: input delayed tonnage + position size, output suggested SGX lots to offset — pure math tool
- **Satellite NDVI plantation health**: Sentinel-2 is free but processing pipeline is heavy

## Parked — needs paid enterprise data (don't build)

- Global shipment manifests / floating supply tonnage (Trademo, Panjiva, ImportGenius — enterprise $$$)
- Container milestone tracking (Vizion, Terminal49 — paid)
- Qingdao bonded warehouse stocks (Mysteel — paid)
- Shandong tire factory operating rates (Longzhong/Mysteel — paid; only via news mentions)
- EUDR premium feed (no public source)

## Fiction — stays fiction

Quantum routing, DePIN farmer payments, bio-acoustic sensors, autonomous AI hedging agents, IoT container telemetry, blockchain LC release.
