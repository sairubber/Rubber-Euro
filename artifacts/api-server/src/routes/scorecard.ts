import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { scorecardsTable, analysesTable, outcomesTable } from "@workspace/db";
import { SCORECARD_PROMPT } from "../lib/prompts";
import { callClaude } from "../lib/anthropicClient";
import { GetScorecardParams, RunScorecardParams } from "@workspace/api-zod";

const router = Router();

// GET /scorecard/:market
router.get("/scorecard/:market", async (req, res): Promise<void> => {
  const parsed = GetScorecardParams.safeParse({ market: req.params["market"] });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [scorecard] = await db
    .select()
    .from(scorecardsTable)
    .where(eq(scorecardsTable.market, parsed.data.market))
    .orderBy(desc(scorecardsTable.created_at))
    .limit(1);

  if (!scorecard) {
    res.status(404).json({ error: "No scorecard found for this market" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(scorecard.payload_json);
  } catch {
    payload = {};
  }

  res.json({
    id: scorecard.id,
    market: scorecard.market,
    payload,
    created_at: scorecard.created_at.toISOString(),
  });
});

// POST /scorecard/run/:market
router.post("/scorecard/run/:market", async (req, res): Promise<void> => {
  const rawMarket = Array.isArray(req.params["market"]) ? req.params["market"][0] : req.params["market"];
  const parsed = RunScorecardParams.safeParse({ market: rawMarket });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const market = parsed.data.market;

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "ANTHROPIC_API_KEY is not configured" });
    return;
  }

  // Get all analyses that have outcomes
  const outcomes = await db
    .select()
    .from(outcomesTable)
    .where(eq(outcomesTable.market, market));

  if (outcomes.length === 0) {
    res.status(400).json({ error: "No outcomes recorded for this market. Enter actual outcomes first." });
    return;
  }

  // Fetch the corresponding analyses
  const analysisIds = outcomes.map((o) => o.analysis_id);
  const analyses = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.market, market));

  const withOutcomes = analyses.filter((a) => analysisIds.includes(a.id));

  if (withOutcomes.length === 0) {
    res.status(400).json({ error: "No matching analyses found" });
    return;
  }

  // Build scorecard user message
  const analysisParts = withOutcomes.map((a) => {
    const outcome = outcomes.find((o) => o.analysis_id === a.id);
    return {
      json: a.payload_json,
      date: a.created_at.toISOString().split("T")[0] ?? "",
      outcome: outcome?.outcome_text ?? "",
    };
  });

  const pastAnalysesPart = analysisParts
    .map((p) => `${p.json} — date ${p.date}`)
    .join("\n");

  const actualOutcomesPart = analysisParts
    .map((p) => `- After ${p.date}: ${p.outcome}`)
    .join("\n");

  const userMessage = `Grade these past predictions against actual outcomes.

Past analyses:
${pastAnalysesPart}

Actual outcomes:
${actualOutcomesPart}

Produce the scorecard in the required JSON format.`;

  try {
    const payload = await callClaude(SCORECARD_PROMPT, userMessage, 1500, false, "scorecard");

    const [inserted] = await db
      .insert(scorecardsTable)
      .values({
        market,
        payload_json: JSON.stringify(payload),
      })
      .returning();

    if (!inserted) {
      res.status(500).json({ error: "Failed to save scorecard" });
      return;
    }

    res.json({
      id: inserted.id,
      market: inserted.market,
      payload,
      created_at: inserted.created_at.toISOString(),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `Claude API error: ${errMsg}` });
  }
});

export default router;
