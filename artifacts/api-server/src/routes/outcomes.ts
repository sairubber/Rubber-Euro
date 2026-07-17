import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { outcomesTable, analysesTable } from "@workspace/db";
import { RecordOutcomeBody, GetAnalysesWithOutcomesParams } from "@workspace/api-zod";

const router = Router();

// POST /outcomes
router.post("/outcomes", async (req, res): Promise<void> => {
  const parsed = RecordOutcomeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { market, analysis_id, outcome_text } = parsed.data;

  const [inserted] = await db
    .insert(outcomesTable)
    .values({ market, analysis_id, outcome_text })
    .returning();

  if (!inserted) {
    res.status(500).json({ error: "Failed to save outcome" });
    return;
  }

  res.status(201).json({
    id: inserted.id,
    market: inserted.market,
    analysis_id: inserted.analysis_id,
    outcome_text: inserted.outcome_text,
    entered_at: inserted.entered_at.toISOString(),
  });
});

// GET /analyses-with-outcomes/:market
router.get("/analyses-with-outcomes/:market", async (req, res): Promise<void> => {
  const parsed = GetAnalysesWithOutcomesParams.safeParse({ market: req.params["market"] });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const market = parsed.data.market;

  const analyses = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.market, market))
    .orderBy(desc(analysesTable.created_at))
    .limit(50);

  const outcomes = await db
    .select()
    .from(outcomesTable)
    .where(eq(outcomesTable.market, market));

  const result = analyses.map((a) => {
    const outcome = outcomes.find((o) => o.analysis_id === a.id);
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(a.payload_json) as Record<string, unknown>;
    } catch {
      // ignore
    }

    const verdict = payload["research_verdict"] as Record<string, unknown> | undefined;
    return {
      id: a.id,
      market: a.market,
      run_mode: a.run_mode,
      headline: (payload["news_headline"] as string | undefined) ?? null,
      conviction: (verdict?.["conviction_score"] as string | undefined) ?? null,
      created_at: a.created_at.toISOString(),
      outcome_id: outcome?.id ?? null,
      outcome_text: outcome?.outcome_text ?? null,
      outcome_entered_at: outcome?.entered_at?.toISOString() ?? null,
    };
  });

  res.json(result);
});

export default router;
