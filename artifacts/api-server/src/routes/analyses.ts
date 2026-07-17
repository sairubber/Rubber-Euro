import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { analysesTable } from "@workspace/db";
import { runMasterJobForMarket } from "../lib/scheduler";
import {
  GetLatestAnalysisParams,
  GetAnalysisHistoryParams,
  GetAnalysisByIdParams,
  TriggerMarketRunParams,
} from "@workspace/api-zod";

const router = Router();

// GET /latest/:market
router.get("/latest/:market", async (req, res): Promise<void> => {
  const parsed = GetLatestAnalysisParams.safeParse({ market: req.params["market"] });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [analysis] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.market, parsed.data.market))
    .orderBy(desc(analysesTable.created_at))
    .limit(1);

  if (!analysis) {
    res.status(404).json({ error: "No analysis found for this market" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(analysis.payload_json);
  } catch {
    payload = {};
  }

  res.json({
    id: analysis.id,
    market: analysis.market,
    run_mode: analysis.run_mode,
    payload,
    created_at: analysis.created_at.toISOString(),
  });
});

// GET /history/:market
router.get("/history/:market", async (req, res): Promise<void> => {
  const parsed = GetAnalysisHistoryParams.safeParse({ market: req.params["market"] });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const analyses = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.market, parsed.data.market))
    .orderBy(desc(analysesTable.created_at))
    .limit(20);

  const result = analyses.map((a) => {
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
    };
  });

  res.json(result);
});

// GET /analysis/:id
router.get("/analysis/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const parsed = GetAnalysisByIdParams.safeParse({ id: parseInt(rawId ?? "0", 10) });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [analysis] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.id, parsed.data.id))
    .limit(1);

  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(analysis.payload_json);
  } catch {
    payload = {};
  }

  res.json({
    id: analysis.id,
    market: analysis.market,
    run_mode: analysis.run_mode,
    payload,
    created_at: analysis.created_at.toISOString(),
  });
});

// POST /run-now/:market
router.post("/run-now/:market", async (req, res): Promise<void> => {
  const rawMarket = Array.isArray(req.params["market"]) ? req.params["market"][0] : req.params["market"];
  const parsed = TriggerMarketRunParams.safeParse({ market: rawMarket });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const market = parsed.data.market;

  // Trigger in background
  void runMasterJobForMarket(market);

  res.status(202).json({
    message: `Analysis run triggered for ${market}`,
    market,
  });
});

export default router;
