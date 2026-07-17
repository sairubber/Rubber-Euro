# Market Intelligence — TSR20 + EUR/USD Research Desk

An automated market-intelligence news website covering two markets: **SGX SICOM TSR20 natural rubber futures** and **EUR/USD forex**. The app uses the Anthropic Claude API with web search to fetch, analyze, and store structured market analyses, rendered as a professional dark research-desk UI.

## Run & Operate

- `pnpm --filter @workspace/market-intel run dev` — run the React frontend (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `ANTHROPIC_API_KEY` — Anthropic Claude API key (add via Replit Secrets)
- Optional env: `ANTHROPIC_MODEL` (default: `claude-sonnet-4-5`), `REFRESH_HOURS` (default: `4`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, TanStack Query, Wouter, Tailwind CSS (dark theme, JetBrains Mono for numbers)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- AI: `@anthropic-ai/sdk` — Claude with web search tool
- Scheduler: `node-cron` (master analysis every N hours, weekly synthesis every Saturday 15:00 IST)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth)
- `lib/db/src/schema/analyses.ts` — all DB table definitions (analyses, flash_alerts, weekly_reports, scorecards, outcomes, failed_runs)
- `artifacts/api-server/src/lib/prompts.ts` — all 4 Claude system prompts (MASTER, FLASH, WEEKLY, SCORECARD) verbatim
- `artifacts/api-server/src/lib/anthropicClient.ts` — Claude API wrapper with JSON extraction and retry logic
- `artifacts/api-server/src/lib/scheduler.ts` — cron scheduler for master and weekly jobs
- `artifacts/api-server/src/routes/` — all API route handlers
- `artifacts/market-intel/src/pages/` — all frontend pages

## Frontend Pages

| Page | Route | Purpose |
|---|---|---|
| Dashboard | `/` | Latest analysis cards for TSR20 & EURUSD, auto-polls every 60s |
| Flash Desk | `/flash` | Breaking news → instant flash assessment |
| Weekly Review | `/weekly` | Weekly institutional synthesis per market |
| Model Scorecard | `/scorecard` | Enter outcomes, generate calibration scorecard |
| Archive | `/history` | All past analyses; click for full detail |
| Analysis Detail | `/analysis/:id` | Full analysis card |
| Port Traffic | `/ports` | MarineTraffic iframe embeds for 7 rubber ports |

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/latest/:market` | Most recent analysis |
| GET | `/api/history/:market` | Past 20 analyses (summary) |
| GET | `/api/analysis/:id` | Full analysis by ID |
| GET | `/api/weekly/:market` | Latest weekly report |
| GET | `/api/scorecard/:market` | Latest scorecard |
| POST | `/api/flash` | Flash assessment on breaking headline |
| POST | `/api/run-now/:market` | Manually trigger analysis run |
| POST | `/api/outcomes` | Record actual outcome for past analysis |
| POST | `/api/scorecard/run/:market` | Generate scorecard from outcomes |
| GET | `/api/analyses-with-outcomes/:market` | Analyses + their outcomes |
| GET | `/api/status` | System status (API key, scheduler, model) |

## Architecture decisions

- Markets are keyed as `TSR20` and `EURUSD` (no slash) in all backend code and DB
- Claude API responses use text-block concatenation + regex JSON extraction + truncation retry
- Scheduler failures are caught and logged; they never crash the server
- All timestamps stored with timezone in PostgreSQL; displayed in IST (UTC+5:30) in the UI
- `failed_runs` table stores raw Claude responses for debugging parse failures
- No authentication in v1; no trading/order features — research/display only

## User preferences

- Display language: Hinglish (Hindi + English mix acceptable in chat, English in UI)

## Gotchas

- Market name must be `EURUSD` (no slash) in API calls — the slash breaks Express routing
- `ANTHROPIC_API_KEY` must be in Replit Secrets before any analysis will run
- Weekly job runs Saturdays 15:00 IST; uses last 7 days of analyses from DB
- Startup triggers one master run per market if DB is empty (gracefully fails if API key missing)
