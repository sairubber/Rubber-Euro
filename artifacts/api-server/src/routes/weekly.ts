import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { weeklyReportsTable } from "@workspace/db";
import { GetWeeklyReportParams } from "@workspace/api-zod";

const router = Router();

// GET /weekly/:market
router.get("/weekly/:market", async (req, res): Promise<void> => {
  const parsed = GetWeeklyReportParams.safeParse({ market: req.params["market"] });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [report] = await db
    .select()
    .from(weeklyReportsTable)
    .where(eq(weeklyReportsTable.market, parsed.data.market))
    .orderBy(desc(weeklyReportsTable.created_at))
    .limit(1);

  if (!report) {
    res.status(404).json({ error: "No weekly report found for this market" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(report.payload_json);
  } catch {
    payload = {};
  }

  res.json({
    id: report.id,
    market: report.market,
    week_start: report.week_start,
    payload,
    created_at: report.created_at.toISOString(),
  });
});

export default router;
