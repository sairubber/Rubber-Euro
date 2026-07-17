import cron from "node-cron";
import { desc, eq, gte, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { analysesTable, weeklyReportsTable } from "@workspace/db";
import { MARKETS, MASTER_PROMPT, WEEKLY_PROMPT, buildMasterMessage } from "./prompts";
import { callClaude } from "./anthropicClient";
import { logger } from "./logger";

const REFRESH_HOURS = parseInt(process.env.REFRESH_HOURS ?? "4", 10);

let schedulerRunning = false;

export function isSchedulerRunning(): boolean {
  return schedulerRunning;
}

export async function runMasterJobForMarket(market: string): Promise<void> {
  const context = MARKETS[market];
  if (!context) {
    logger.warn({ market }, "Unknown market, skipping master job");
    return;
  }

  logger.info({ market }, "Starting master analysis job");

  try {
    // Fetch most recent analysis
    const [prev] = await db
      .select()
      .from(analysesTable)
      .where(eq(analysesTable.market, market))
      .orderBy(desc(analysesTable.created_at))
      .limit(1);

    let runMode: "normal" | "delta" = "normal";
    let userMessage: string;

    if (prev) {
      const prevTimestamp = prev.created_at.toISOString();
      userMessage = buildMasterMessage(market, context, prev.payload_json, prevTimestamp);
      runMode = "delta";
    } else {
      userMessage = buildMasterMessage(market, context);
    }

    const payload = await callClaude(MASTER_PROMPT, userMessage, 8000, true, "master");

    await db.insert(analysesTable).values({
      market,
      run_mode: runMode,
      payload_json: JSON.stringify(payload),
    });

    logger.info({ market, runMode }, "Master analysis completed and saved");
  } catch (err) {
    logger.error({ err, market }, "Master analysis job failed");
    // Never rethrow — scheduler must not crash
  }
}

async function runWeeklyJobForMarket(market: string): Promise<void> {
  logger.info({ market }, "Starting weekly report job");

  try {
    // Gather last 7 days of analyses
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const analyses = await db
      .select()
      .from(analysesTable)
      .where(and(eq(analysesTable.market, market), gte(analysesTable.created_at, sevenDaysAgo)))
      .orderBy(analysesTable.created_at);

    if (analyses.length === 0) {
      logger.warn({ market }, "No analyses found for weekly report, skipping");
      return;
    }

    const dateRange = `${sevenDaysAgo.toISOString().split("T")[0]} to ${new Date().toISOString().split("T")[0]}`;
    const dayAnalyses = analyses.map((a) => a.payload_json).join("\n");

    const userMessage = `Market: ${market}
Week: ${dateRange}
Daily analyses (chronological):
${dayAnalyses}
Produce the weekly synthesis in the required JSON format.`;

    const payload = await callClaude(WEEKLY_PROMPT, userMessage, 2000, true, "weekly");

    await db.insert(weeklyReportsTable).values({
      market,
      week_start: sevenDaysAgo.toISOString().split("T")[0] ?? "",
      payload_json: JSON.stringify(payload),
    });

    logger.info({ market }, "Weekly report completed and saved");
  } catch (err) {
    logger.error({ err, market }, "Weekly report job failed");
  }
}

async function checkAndRunStartupJobs(): Promise<void> {
  // If analyses table is empty, trigger one master run per market
  const [firstAnalysis] = await db.select().from(analysesTable).limit(1);

  if (!firstAnalysis) {
    logger.info("No analyses found on startup, triggering initial runs for all markets");
    for (const market of Object.keys(MARKETS)) {
      // Run in background, don't await
      void runMasterJobForMarket(market);
    }
  }
}

export function startScheduler(): void {
  schedulerRunning = true;

  // Recurring master job: every REFRESH_HOURS hours
  // Using cron expression: every N hours at minute 0
  const hourInterval = REFRESH_HOURS <= 1 ? "*/1" : `*/${REFRESH_HOURS}`;
  const masterCron = `0 ${hourInterval} * * *`;

  cron.schedule(masterCron, async () => {
    for (const market of Object.keys(MARKETS)) {
      await runMasterJobForMarket(market);
    }
  });

  // Weekly job: every Saturday at 15:00 IST (09:30 UTC)
  cron.schedule("30 9 * * 6", async () => {
    for (const market of Object.keys(MARKETS)) {
      await runWeeklyJobForMarket(market);
    }
  });

  logger.info({ refreshHours: REFRESH_HOURS }, "Scheduler started");

  // Startup check — run async without blocking server start
  void checkAndRunStartupJobs().catch((err) => {
    logger.error({ err }, "Startup job check failed");
  });
}
