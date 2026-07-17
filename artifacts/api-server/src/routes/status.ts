import { Router } from "express";
import { MARKETS } from "../lib/prompts";
import { isSchedulerRunning } from "../lib/scheduler";

const router = Router();

// GET /status
router.get("/status", async (_req, res): Promise<void> => {
  const refreshHours = parseInt(process.env.REFRESH_HOURS ?? "4", 10);
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

  res.json({
    api_key_configured: !!process.env.ANTHROPIC_API_KEY,
    scheduler_running: isSchedulerRunning(),
    markets: Object.keys(MARKETS),
    refresh_hours: refreshHours,
    model,
  });
});

export default router;
